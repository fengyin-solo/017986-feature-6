import { AudioAnalyzer } from './modules/audioAnalyzer.js';
import { ChartManager } from './modules/chartManager.js';
import { UIController } from './modules/uiController.js';
import { RecordManager } from './modules/recordManager.js';
import { Logger } from './utils/logger.js';

// 初始化日志
const logger = new Logger('Main');

// 应用初始化
class App {
  constructor() {
    this.audioAnalyzer = null;
    this.chartManager = null;
    this.uiController = null;
    this.recordManager = null;
    this.audioBuffer = null;
    this.audioContext = null;
    this.currentAnalysisResult = null;
    this.currentFileName = '';
    this.selectedRecordId = null;
    // 历史记录视图状态（检索、排序、选中项），用于返回列表时恢复
    this.recordsViewState = {
      query: '',
      sortBy: 'time-desc',
      selectedIds: new Set()
    };
    this.recordsScrollTop = 0;
    this.searchDebounceTimer = null;
    this.VIEW_STATE_KEY = 'guqin_records_view_state';
  }

  async init() {
    logger.info('应用初始化开始');

    try {
      // 初始化 AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // 初始化模块
      this.audioAnalyzer = new AudioAnalyzer(this.audioContext);
      this.chartManager = new ChartManager();
      this.uiController = new UIController();
      this.recordManager = new RecordManager();

      // 绑定事件
      this.bindEvents();

      // 恢复上次的检索/排序状态
      this.restoreRecordsViewState();

      // 加载历史记录列表
      this.updateRecordsList();

      logger.info('应用初始化完成');
    } catch (error) {
      logger.error('应用初始化失败', error);
      alert('应用初始化失败，请刷新页面重试');
    }
  }

  bindEvents() {
    // 文件上传
    const uploadArea = document.getElementById('uploadArea');
    const audioInput = document.getElementById('audioInput');
    const removeFile = document.getElementById('removeFile');

    uploadArea.addEventListener('click', () => audioInput.click());
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) this.handleFileUpload(file);
    });

    audioInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.handleFileUpload(file);
    });

    removeFile.addEventListener('click', () => this.removeAudioFile());

    // 区间选择
    const startTime = document.getElementById('startTime');
    const endTime = document.getElementById('endTime');
    startTime.addEventListener('input', () => this.updateRangeSlider());
    endTime.addEventListener('input', () => this.updateRangeSlider());

    // 范围滑块拖拽
    this.initRangeSlider();

    // 分析按钮
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.addEventListener('click', () => this.analyzeAudio());

    // 记录相关事件
    this.bindRecordEvents();
  }

  async handleFileUpload(file) {
    // 验证文件类型
    if (!file.type.startsWith('audio/')) {
      alert('请上传有效的音频文件');
      return;
    }

    this.currentFileName = file.name;
    logger.info('开始加载音频文件', { name: file.name, size: file.size });

    try {
      // 显示加载状态
      this.uiController.showLoading('正在加载音频...');

      // 读取文件
      const arrayBuffer = await file.arrayBuffer();
      
      // 解码音频
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // 更新 UI
      const duration = this.audioBuffer.duration;
      const durationMs = Math.floor(duration * 1000);

      document.getElementById('fileName').textContent = file.name;
      document.getElementById('fileInfo').style.display = 'flex';
      document.getElementById('uploadArea').style.display = 'none';

      // 设置音频播放器
      const audioPlayer = document.getElementById('audioPlayer');
      audioPlayer.src = URL.createObjectURL(file);
      document.getElementById('audioPlayerSection').style.display = 'block';
      document.getElementById('totalDuration').textContent = duration.toFixed(3);

      // 设置区间选择
      document.getElementById('startTime').value = 0;
      document.getElementById('startTime').max = durationMs;
      document.getElementById('endTime').value = durationMs;
      document.getElementById('endTime').max = durationMs;

      this.updateRangeSlider();

      // 启用分析按钮
      document.getElementById('analyzeBtn').disabled = false;

      logger.info('音频文件加载成功', { duration, sampleRate: this.audioBuffer.sampleRate });
    } catch (error) {
      logger.error('音频文件加载失败', error);
      alert('音频文件加载失败，请确保文件格式正确');
    } finally {
      this.uiController.hideLoading();
    }
  }

  removeAudioFile() {
    this.audioBuffer = null;
    this.currentAnalysisResult = null;
    this.currentFileName = '';
    document.getElementById('audioInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('uploadArea').style.display = 'block';
    document.getElementById('audioPlayerSection').style.display = 'none';
    document.getElementById('analyzeBtn').disabled = true;
    document.getElementById('chartContainer').style.display = 'none';
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('fundamentalInfo').style.display = 'none';
    document.getElementById('saveRecordSection').style.display = 'none';
    
    // 清除图表
    this.chartManager.clearAllCharts();

    logger.info('音频文件已移除');
  }

  initRangeSlider() {
    const track = document.getElementById('rangeTrack');
    const handleStart = document.getElementById('handleStart');
    const handleEnd = document.getElementById('handleEnd');
    let isDragging = null;

    const updateFromSlider = (clientX) => {
      const rect = track.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const maxMs = parseInt(document.getElementById('endTime').max) || 1000;
      const value = Math.round(percent * maxMs);

      if (isDragging === 'start') {
        const endValue = parseInt(document.getElementById('endTime').value);
        if (value < endValue) {
          document.getElementById('startTime').value = value;
        }
      } else if (isDragging === 'end') {
        const startValue = parseInt(document.getElementById('startTime').value);
        if (value > startValue) {
          document.getElementById('endTime').value = value;
        }
      }

      this.updateRangeSlider();
    };

    handleStart.addEventListener('mousedown', () => isDragging = 'start');
    handleEnd.addEventListener('mousedown', () => isDragging = 'end');

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        updateFromSlider(e.clientX);
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = null;
    });
  }

  updateRangeSlider() {
    let startTime = parseInt(document.getElementById('startTime').value) || 0;
    let endTime = parseInt(document.getElementById('endTime').value) || 0;
    const maxTime = parseInt(document.getElementById('endTime').max) || 1000;

    // 确保起始时间不大于结束时间
    if (startTime > endTime) {
      // 交换值
      const temp = startTime;
      startTime = endTime;
      endTime = temp;
      document.getElementById('startTime').value = startTime;
      document.getElementById('endTime').value = endTime;
    }

    // 确保值在有效范围内
    startTime = Math.max(0, Math.min(startTime, maxTime));
    endTime = Math.max(0, Math.min(endTime, maxTime));

    const startPercent = (startTime / maxTime) * 100;
    const endPercent = (endTime / maxTime) * 100;

    document.getElementById('handleStart').style.left = `${startPercent}%`;
    document.getElementById('handleEnd').style.left = `${endPercent}%`;
    document.getElementById('rangeSelected').style.left = `${startPercent}%`;
    document.getElementById('rangeSelected').style.width = `${Math.max(0, endPercent - startPercent)}%`;

    const durationSec = Math.max(0, endTime - startTime) / 1000;
    document.getElementById('selectedDuration').textContent = durationSec.toFixed(3);
  }

  async analyzeAudio() {
    if (!this.audioBuffer) {
      alert('请先上传音频文件');
      return;
    }

    const startMs = parseInt(document.getElementById('startTime').value) || 0;
    const endMs = parseInt(document.getElementById('endTime').value) || 0;

    if (startMs >= endMs) {
      alert('请选择有效的时间区间');
      return;
    }

    logger.info('开始分析音频', { startMs, endMs });

    try {
      this.uiController.showLoading('正在分析音频...');

      // 获取 FFT 大小
      const fftSize = parseInt(document.getElementById('fftSize').value);

      // 提取选定区间的音频数据
      const startSample = Math.floor((startMs / 1000) * this.audioBuffer.sampleRate);
      const endSample = Math.floor((endMs / 1000) * this.audioBuffer.sampleRate);
      const channelData = this.audioBuffer.getChannelData(0);
      const selectedData = channelData.slice(startSample, endSample);

      // 分析音频
      const analysisResult = await this.audioAnalyzer.analyze(selectedData, this.audioBuffer.sampleRate, fftSize);

      logger.info('音频分析完成', { 
        fundamentalFreq: analysisResult.fundamentalFreq,
        harmonicsCount: analysisResult.harmonics.length 
      });

      // 保存当前分析结果
      this.currentAnalysisResult = analysisResult;

      // 更新图表
      this.chartManager.updateAllCharts(analysisResult, selectedData, this.audioBuffer.sampleRate);

      // 更新基频信息
      this.updateFundamentalInfo(analysisResult);

      // 显示图表区域
      document.getElementById('chartContainer').style.display = 'flex';
      document.getElementById('emptyState').style.display = 'none';

      // 显示保存记录区域
      document.getElementById('saveRecordSection').style.display = 'block';
      document.getElementById('recordName').value = `${this.currentFileName} - ${this.recordManager.formatTimestamp()}`;
      document.getElementById('recordNote').value = '';

    } catch (error) {
      logger.error('音频分析失败', error);
      alert('音频分析失败: ' + error.message);
    } finally {
      this.uiController.hideLoading();
    }
  }

  updateFundamentalInfo(result) {
    document.getElementById('fundamentalInfo').style.display = 'block';
    document.getElementById('fundamentalFreq').textContent = result.fundamentalFreq.toFixed(2);

    const harmonicsList = document.getElementById('harmonicsList');
    harmonicsList.innerHTML = result.harmonics.map((h, i) => `
      <div class="harmonic-item">
        <span class="harmonic-label">${i + 2}倍频</span>
        <span class="harmonic-freq">${h.toFixed(1)} Hz</span>
      </div>
    `).join('');
  }

  bindRecordEvents() {
    // 保存记录按钮
    document.getElementById('saveRecordBtn').addEventListener('click', () => this.saveRecord());

    // 展开/收起记录列表
    document.getElementById('toggleRecordsBtn').addEventListener('click', () => this.toggleRecordsPanel());

    // 检索输入（防抖）
    document.getElementById('recordSearchInput').addEventListener('input', () => this.handleSearchInput());

    // 清除检索
    document.getElementById('clearSearchBtn').addEventListener('click', () => this.clearSearch());

    // 排序方式
    document.getElementById('recordSortSelect').addEventListener('change', (e) => {
      this.recordsViewState.sortBy = e.target.value;
      this.saveRecordsViewState();
      this.updateRecordsList();
    });

    // 全选
    document.getElementById('selectAllRecords').addEventListener('change', (e) => {
      this.toggleSelectAll(e.target.checked);
    });

    // 导出选中记录
    document.getElementById('exportRecordsBtn').addEventListener('click', () => this.exportSelectedRecords());

    // 记录列表滚动位置跟踪
    document.getElementById('recordsContent').addEventListener('scroll', (e) => {
      this.recordsScrollTop = e.target.scrollTop;
      this.saveRecordsViewState();
    });

    // 关闭模态框
    document.getElementById('closeModalBtn').addEventListener('click', () => this.closeRecordModal());
    document.getElementById('recordDetailModal').addEventListener('click', (e) => {
      if (e.target.id === 'recordDetailModal') {
        this.closeRecordModal();
      }
    });

    // 应用记录
    document.getElementById('applyRecordBtn').addEventListener('click', () => this.applyRecord());

    // 删除记录
    document.getElementById('deleteRecordBtn').addEventListener('click', () => this.deleteRecord());
  }

  saveRecord() {
    if (!this.currentAnalysisResult) {
      this.uiController.showToast('没有可保存的分析结果', 'warning');
      return;
    }

    const name = document.getElementById('recordName').value.trim();
    const note = document.getElementById('recordNote').value.trim();
    const startMs = parseInt(document.getElementById('startTime').value) || 0;
    const endMs = parseInt(document.getElementById('endTime').value) || 0;

    const harmonicIntensities = this.extractHarmonicIntensities(this.currentAnalysisResult);

    try {
      const record = this.recordManager.createRecord({
        fileName: this.currentFileName,
        startMs,
        endMs,
        fundamentalFreq: this.currentAnalysisResult.fundamentalFreq,
        harmonics: this.currentAnalysisResult.harmonics,
        harmonicIntensities,
        analysisResult: this.currentAnalysisResult,
        name: name
      });

      if (note) {
        this.recordManager.updateRecord(record.id, { note });
      }

      this.uiController.showToast('记录保存成功', 'success');
      this.updateRecordsList();
    } catch (error) {
      this.uiController.showToast(error.message, 'error');
    }
  }

  extractHarmonicIntensities(analysisResult) {
    const { fundamentalFreq, harmonics, frequencies, magnitudes } = analysisResult;
    const allHarmonics = [fundamentalFreq, ...harmonics];
    const intensities = {};

    allHarmonics.forEach((harmonic, index) => {
      let closestMag = 0;
      let minDist = Infinity;

      for (let i = 0; i < frequencies.length; i++) {
        const dist = Math.abs(frequencies[i] - harmonic);
        if (dist < minDist) {
          minDist = dist;
          closestMag = magnitudes[i];
        }
      }

      const key = index === 0 ? 'fundamental' : `harmonic${index + 1}`;
      intensities[key] = closestMag;
    });

    const maxMag = Math.max(...Object.values(intensities));
    const normalizedIntensities = {};
    Object.keys(intensities).forEach(key => {
      normalizedIntensities[key] = maxMag > 0 ? (intensities[key] / maxMag) * 100 : 0;
    });

    return normalizedIntensities;
  }

  updateRecordsList() {
    const allRecords = this.recordManager.getAllRecords();
    const recordsList = document.getElementById('recordsList');
    const recordsEmpty = document.getElementById('recordsEmpty');
    const recordsNoResult = document.getElementById('recordsNoResult');

    // 清理已不存在的选中项
    const existingIds = new Set(allRecords.map(r => r.id));
    this.recordsViewState.selectedIds.forEach(id => {
      if (!existingIds.has(id)) {
        this.recordsViewState.selectedIds.delete(id);
      }
    });

    if (allRecords.length === 0) {
      recordsList.style.display = 'none';
      recordsEmpty.style.display = 'flex';
      recordsNoResult.style.display = 'none';
      this.updateSelectionBar([]);
      return;
    }

    const records = this.recordManager.queryRecords({
      query: this.recordsViewState.query,
      sortBy: this.recordsViewState.sortBy
    });

    recordsEmpty.style.display = 'none';

    // 有记录但检索无匹配结果
    if (records.length === 0) {
      recordsList.style.display = 'none';
      recordsNoResult.style.display = 'flex';
      this.updateSelectionBar([]);
      return;
    }

    recordsNoResult.style.display = 'none';
    recordsList.style.display = 'block';

    recordsList.innerHTML = records.map(record => `
      <div class="record-item" data-id="${record.id}">
        <input type="checkbox" class="record-checkbox" data-id="${record.id}" ${this.recordsViewState.selectedIds.has(record.id) ? 'checked' : ''}>
        <div class="record-info">
          <div class="record-main">
            <span class="record-name" title="${this.escapeHtml(record.name)}">${this.escapeHtml(this.truncateText(record.name, 25))}</span>
            <span class="record-freq">${record.fundamentalFreq.toFixed(1)} Hz</span>
          </div>
          <div class="record-meta">
            <span class="record-file" title="${this.escapeHtml(record.fileName)}">${this.escapeHtml(this.truncateText(record.fileName, 20))}</span>
            <span class="record-time">${this.recordManager.formatDate(record.createdAt)}</span>
          </div>
        </div>
      </div>
    `).join('');

    recordsList.querySelectorAll('.record-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 点击复选框时不打开详情
        if (e.target.classList.contains('record-checkbox')) return;
        this.showRecordDetail(item.dataset.id);
      });
    });

    recordsList.querySelectorAll('.record-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const id = checkbox.dataset.id;
        if (checkbox.checked) {
          this.recordsViewState.selectedIds.add(id);
        } else {
          this.recordsViewState.selectedIds.delete(id);
        }
        this.updateSelectionBar(this.recordManager.queryRecords({
          query: this.recordsViewState.query,
          sortBy: this.recordsViewState.sortBy
        }));
      });
    });

    // 恢复列表滚动位置（打开详情再返回、删除记录后保持原位）
    document.getElementById('recordsContent').scrollTop = this.recordsScrollTop;

    this.updateSelectionBar(records);
  }

  /**
   * 处理检索输入（防抖 + 校验）
   */
  handleSearchInput() {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      const input = document.getElementById('recordSearchInput');
      const hint = document.getElementById('searchHint');
      const query = input.value;

      const { valid, error } = this.recordManager.validateSearchQuery(query);
      if (!valid) {
        // 校验失败：提示原因，保持上次有效的检索结果不变
        hint.textContent = error;
        hint.style.display = 'block';
        input.classList.add('input-error');
        logger.warn('检索条件校验失败', { error });
        return;
      }

      hint.style.display = 'none';
      input.classList.remove('input-error');
      this.recordsViewState.query = query;
      this.saveRecordsViewState();
      this.updateRecordsList();
    }, 200);
  }

  /**
   * 清除检索条件
   */
  clearSearch() {
    const input = document.getElementById('recordSearchInput');
    input.value = '';
    input.classList.remove('input-error');
    document.getElementById('searchHint').style.display = 'none';
    this.recordsViewState.query = '';
    this.saveRecordsViewState();
    this.updateRecordsList();
  }

  /**
   * 全选/取消全选当前筛选结果
   * @param {boolean} checked - 是否全选
   */
  toggleSelectAll(checked) {
    const visible = this.recordManager.queryRecords({
      query: this.recordsViewState.query,
      sortBy: this.recordsViewState.sortBy
    });
    visible.forEach(record => {
      if (checked) {
        this.recordsViewState.selectedIds.add(record.id);
      } else {
        this.recordsViewState.selectedIds.delete(record.id);
      }
    });
    this.updateRecordsList();
  }

  /**
   * 更新选中状态栏（计数、导出按钮、全选框状态）
   * @param {Array} visibleRecords - 当前筛选出的记录
   */
  updateSelectionBar(visibleRecords) {
    const count = this.recordsViewState.selectedIds.size;
    document.getElementById('selectedCount').textContent = `已选 ${count} 条`;
    document.getElementById('exportRecordsBtn').disabled = count === 0;

    const selectAll = document.getElementById('selectAllRecords');
    const selectedVisible = visibleRecords.filter(r => this.recordsViewState.selectedIds.has(r.id));
    selectAll.checked = visibleRecords.length > 0 && selectedVisible.length === visibleRecords.length;
    selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleRecords.length;
  }

  /**
   * 导出选中的记录为归档文件
   */
  exportSelectedRecords() {
    const ids = [...this.recordsViewState.selectedIds];
    if (ids.length === 0) {
      this.uiController.showToast('请先勾选要导出的记录', 'warning');
      return;
    }

    try {
      const json = this.recordManager.exportRecordsByIds(ids);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

      const link = document.createElement('a');
      link.href = url;
      link.download = `guqin-records-archive-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      this.uiController.showToast(`已导出 ${ids.length} 条记录`, 'success');
      logger.info('导出记录归档成功', { count: ids.length });
    } catch (error) {
      logger.error('导出记录归档失败', error);
      this.uiController.showToast('导出失败，请重试', 'error');
    }
  }

  /**
   * 保存记录视图状态到 sessionStorage
   */
  saveRecordsViewState() {
    try {
      sessionStorage.setItem(this.VIEW_STATE_KEY, JSON.stringify({
        query: this.recordsViewState.query,
        sortBy: this.recordsViewState.sortBy,
        scrollTop: this.recordsScrollTop
      }));
    } catch (error) {
      logger.warn('保存视图状态失败', error);
    }
  }

  /**
   * 从 sessionStorage 恢复记录视图状态
   */
  restoreRecordsViewState() {
    try {
      const raw = sessionStorage.getItem(this.VIEW_STATE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        if (typeof state.query === 'string') {
          this.recordsViewState.query = state.query;
        }
        if (typeof state.sortBy === 'string') {
          this.recordsViewState.sortBy = state.sortBy;
        }
        if (typeof state.scrollTop === 'number') {
          this.recordsScrollTop = state.scrollTop;
        }
      }
    } catch (error) {
      logger.warn('恢复视图状态失败', error);
    }

    // 同步到界面控件
    document.getElementById('recordSearchInput').value = this.recordsViewState.query;
    document.getElementById('recordSortSelect').value = this.recordsViewState.sortBy;
  }

  /**
   * HTML 转义，防止记录名称等内容注入
   * @param {string} text - 原始文本
   * @returns {string} 转义后的文本
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  toggleRecordsPanel() {
    const wrapper = document.getElementById('recordsWrapper');
    const btn = document.getElementById('toggleRecordsBtn');

    if (wrapper.style.display === 'none') {
      wrapper.style.display = 'block';
      btn.textContent = '▼';
    } else {
      wrapper.style.display = 'none';
      btn.textContent = '▶';
    }
  }

  showRecordDetail(recordId) {
    const record = this.recordManager.getRecord(recordId);
    if (!record) return;

    this.selectedRecordId = recordId;

    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = record.name;

    modalBody.innerHTML = `
      <div class="record-detail">
        <div class="detail-section">
          <h4>基本信息</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">文件名</span>
              <span class="detail-value">${this.escapeHtml(record.fileName)}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">创建时间</span>
              <span class="detail-value">${this.recordManager.formatTimestampFull(record.createdAt)}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">分析区间</span>
              <span class="detail-value">${record.startMs}ms - ${record.endMs}ms (${(record.durationMs / 1000).toFixed(3)}s)</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">基频</span>
              <span class="detail-value highlight">${record.fundamentalFreq.toFixed(2)} Hz</span>
            </div>
          </div>
        </div>
        
        <div class="detail-section">
          <h4>倍频与强度</h4>
          <div class="harmonics-table">
            <div class="table-header">
              <span>谐波</span>
              <span>频率</span>
              <span>相对强度</span>
            </div>
            <div class="table-row">
              <span>基频</span>
              <span>${record.fundamentalFreq.toFixed(1)} Hz</span>
              <span>
                <div class="intensity-bar">
                  <div class="intensity-fill" style="width: ${record.harmonicIntensities?.fundamental || 100}%"></div>
                  <span class="intensity-text">${(record.harmonicIntensities?.fundamental || 100).toFixed(1)}%</span>
                </div>
              </span>
            </div>
            ${record.harmonics.map((h, i) => {
              const intensityKey = `harmonic${i + 2}`;
              const intensity = record.harmonicIntensities?.[intensityKey] || 0;
              return `
                <div class="table-row">
                  <span>${i + 2}倍频</span>
                  <span>${h.toFixed(1)} Hz</span>
                  <span>
                    <div class="intensity-bar">
                      <div class="intensity-fill" style="width: ${intensity}%"></div>
                      <span class="intensity-text">${intensity.toFixed(1)}%</span>
                    </div>
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        
        ${record.note ? `
          <div class="detail-section">
            <h4>备注</h4>
            <p class="record-note">${this.escapeHtml(record.note)}</p>
          </div>
        ` : ''}
      </div>
    `;

    document.getElementById('recordDetailModal').style.display = 'flex';
  }

  closeRecordModal() {
    document.getElementById('recordDetailModal').style.display = 'none';
    this.selectedRecordId = null;
    // 返回列表时恢复之前的滚动位置
    document.getElementById('recordsContent').scrollTop = this.recordsScrollTop;
  }

  applyRecord() {
    if (!this.selectedRecordId) return;

    const record = this.recordManager.getRecord(this.selectedRecordId);
    if (!record) return;

    if (!record.analysisResult) {
      this.uiController.showToast('该记录不包含完整的分析数据', 'warning');
      return;
    }

    this.currentAnalysisResult = record.analysisResult;

    const fakeAudioData = new Float32Array(1000).fill(0);
    const sampleRate = 44100;
    this.chartManager.updateAllCharts(record.analysisResult, fakeAudioData, sampleRate);
    this.updateFundamentalInfo(record.analysisResult);

    document.getElementById('chartContainer').style.display = 'flex';
    document.getElementById('emptyState').style.display = 'none';

    this.closeRecordModal();
    this.uiController.showToast('记录已应用', 'success');
  }

  deleteRecord() {
    if (!this.selectedRecordId) return;

    if (confirm('确定要删除这条记录吗？此操作不可恢复。')) {
      const success = this.recordManager.deleteRecord(this.selectedRecordId);
      if (success) {
        this.updateRecordsList();
        this.closeRecordModal();
        this.uiController.showToast('记录已删除', 'success');
      } else {
        this.uiController.showToast('删除失败', 'error');
      }
    }
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});

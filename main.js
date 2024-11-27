// DOM Elements
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const uploadButton = document.getElementById('uploadButton');
const message = document.getElementById('message');
const uploadPath = document.getElementById('uploadPath');

// Config Elements
const accessKeyIdInput = document.getElementById('accessKeyId');
const secretAccessKeyInput = document.getElementById('secretAccessKey');
const regionInput = document.getElementById('region');
const bucketNameInput = document.getElementById('bucketName');
const saveConfigButton = document.getElementById('saveConfig');

// Selected files
let selectedFiles = [];
let s3 = null;
const MAX_RETRIES = 3;

// Debug logging with timestamps
function debug(msg, data) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`, data || '');
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Load saved configuration
function loadSavedConfig() {
    debug('Loading saved configuration...');
    const savedConfig = localStorage.getItem('s3Config');
    if (savedConfig) {
        const config = JSON.parse(savedConfig);
        accessKeyIdInput.value = config.accessKeyId || '';
        secretAccessKeyInput.value = config.secretAccessKey || '';
        regionInput.value = config.region || 'us-east-1';
        bucketNameInput.value = config.bucketName || '';
        initializeS3();
    }
}

// Update upload button state
function updateUploadButtonState() {
    uploadButton.disabled = !s3 || selectedFiles.length === 0;
    debug('Upload button state updated', { 
        disabled: uploadButton.disabled, 
        hasS3: !!s3, 
        filesCount: selectedFiles.length 
    });
}

// Initialize S3 with current configuration
function initializeS3() {
    const accessKeyId = accessKeyIdInput.value.trim();
    const secretAccessKey = secretAccessKeyInput.value.trim();
    const region = regionInput.value.trim() || 'us-east-1';

    debug('Initializing S3 client...', { region });

    if (accessKeyId && secretAccessKey) {
        try {
            // Configure AWS SDK
            AWS.config.update({
                credentials: new AWS.Credentials(accessKeyId, secretAccessKey),
                region: region,
                maxRetries: 3,
                httpOptions: {
                    timeout: 0,
                    connectTimeout: 5000,
                    retryDelayOptions: { base: 300 }
                }
            });

            // Create S3 client
            s3 = new AWS.S3({
                params: { Bucket: bucketNameInput.value.trim() },
                signatureVersion: 'v4'
            });
            
            debug('S3 client initialized successfully');
            updateUploadButtonState();
            showMessage('S3 配置已更新', 'success');

            // Test S3 connection
            testS3Connection();
        } catch (error) {
            console.error('S3 initialization error:', error);
            showMessage('S3 配置错误: ' + error.message, 'error');
            s3 = null;
            updateUploadButtonState();
        }
    }
}

// Test S3 connection with retries
async function testS3Connection(retryCount = 0) {
    const bucket = bucketNameInput.value.trim();
    debug('Testing S3 connection...', { bucket, retryCount });

    try {
        const data = await s3.listObjectsV2({ Bucket: bucket, MaxKeys: 1 }).promise();
        debug('S3 connection test successful', data);
        showMessage('S3连接测试成功', 'success');
    } catch (error) {
        console.error('S3 connection test failed:', error);
        if (retryCount < 2 && error.code === 'NetworkingError') {
            debug('Retrying connection test...', { retryCount });
            setTimeout(() => testS3Connection(retryCount + 1), 1000 * (retryCount + 1));
        } else {
            showMessage('S3连接测试失败: ' + error.message, 'error');
        }
    }
}

// Create file item element
function createFileItem(file) {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.id = `file-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    const header = document.createElement('div');
    header.className = 'file-item-header';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = file.name;
    
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = formatFileSize(file.size);
    
    header.appendChild(nameSpan);
    header.appendChild(sizeSpan);
    
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressContainer.appendChild(progressBar);
    
    const status = document.createElement('div');
    status.className = 'file-status status-pending';
    status.textContent = '等待上传';
    
    fileItem.appendChild(header);
    fileItem.appendChild(progressContainer);
    fileItem.appendChild(status);
    
    return fileItem;
}

// Handle file selection
fileInput.addEventListener('change', (event) => {
    selectedFiles = Array.from(event.target.files);
    fileList.innerHTML = '';
    
    if (selectedFiles.length > 0) {
        debug('Files selected', {
            count: selectedFiles.length,
            files: selectedFiles.map(f => ({
                name: f.name,
                type: f.type,
                size: f.size
            }))
        });
        
        selectedFiles.forEach(file => {
            fileList.appendChild(createFileItem(file));
        });
    }
    
    updateUploadButtonState();
});

// Handle file upload with retries
async function uploadFileWithRetry(file, params, retryCount = 0) {
    const fileId = `file-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const fileItem = document.getElementById(fileId);
    const progressBar = fileItem.querySelector('.progress-bar');
    const status = fileItem.querySelector('.file-status');
    
    try {
        status.textContent = '上传中...';
        status.className = 'file-status status-uploading';
        
        const upload = s3.upload(params);

        upload.on('httpUploadProgress', (progress) => {
            const percentage = Math.round((progress.loaded / progress.total) * 100);
            progressBar.style.width = `${percentage}%`;
            debug('Upload progress', { 
                file: file.name,
                loaded: progress.loaded,
                total: progress.total,
                percentage: percentage
            });
        });

        const result = await upload.promise();
        debug('Upload completed successfully', { file: file.name, result });
        
        progressBar.style.width = '100%';
        status.textContent = '上传成功';
        status.className = 'file-status status-success';
        
        return result;
    } catch (error) {
        debug('Upload attempt failed', { file: file.name, error, retryCount });
        
        if (retryCount < MAX_RETRIES && (error.code === 'NetworkingError' || error.retryable)) {
            const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
            debug(`Retrying upload in ${delay}ms...`, { file: file.name });
            
            status.textContent = `重试中... (${retryCount + 1}/${MAX_RETRIES})`;
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return uploadFileWithRetry(file, params, retryCount + 1);
        }
        
        progressBar.style.width = '0%';
        status.textContent = `上传失败: ${error.message}`;
        status.className = 'file-status status-error';
        throw error;
    }
}

// Handle multiple file uploads
uploadButton.addEventListener('click', async () => {
    if (!selectedFiles.length || !s3) {
        showMessage('请先选择文件并配置S3', 'error');
        return;
    }

    debug('Starting multiple file upload...', {
        fileCount: selectedFiles.length,
        files: selectedFiles.map(f => f.name)
    });

    uploadButton.disabled = true;
    let successCount = 0;
    let failureCount = 0;

    try {
        let path = uploadPath.value.trim();
        if (path && !path.endsWith('/')) {
            path += '/';
        }

        const bucket = bucketNameInput.value.trim();
        const uploadPromises = selectedFiles.map(async (file) => {
            const key = `${path}${Date.now()}-${file.name}`;
            
            debug('Preparing upload parameters', { 
                file: file.name,
                bucket,
                key
            });

            const params = {
                Bucket: bucket,
                Key: key,
                Body: file,
                ContentType: file.type || 'application/octet-stream'
            };

            try {
                await uploadFileWithRetry(file, params);
                successCount++;
            } catch (error) {
                failureCount++;
                console.error(`Failed to upload ${file.name}:`, error);
            }
        });

        await Promise.all(uploadPromises);

        if (successCount === selectedFiles.length) {
            showMessage(`所有文件上传成功！`, 'success');
        } else {
            showMessage(`上传完成: ${successCount}个成功, ${failureCount}个失败`, 
                failureCount > 0 ? 'error' : 'success');
        }

        // Reset form if all files were successful
        if (failureCount === 0) {
            fileInput.value = '';
            fileList.innerHTML = '';
            selectedFiles = [];
        }
        updateUploadButtonState();
    } catch (error) {
        console.error('Upload error:', error);
        showMessage('上传过程中发生错误: ' + error.message, 'error');
        updateUploadButtonState();
    }
});

// Save configuration
saveConfigButton.addEventListener('click', () => {
    const accessKeyId = accessKeyIdInput.value.trim();
    const secretAccessKey = secretAccessKeyInput.value.trim();
    const region = regionInput.value.trim() || 'us-east-1';
    const bucketName = bucketNameInput.value.trim();

    if (!accessKeyId || !secretAccessKey || !bucketName) {
        showMessage('请填写所有配置项', 'error');
        return;
    }

    const config = {
        accessKeyId,
        secretAccessKey,
        region,
        bucketName
    };

    debug('Saving configuration...', { region, bucketName });
    localStorage.setItem('s3Config', JSON.stringify(config));
    initializeS3();
});

// Path validation
uploadPath.addEventListener('input', (event) => {
    let path = event.target.value.trim();
    
    if (path.startsWith('/')) {
        path = path.substring(1);
        event.target.value = path;
    }
    
    if (path && !/^[a-zA-Z0-9-_/]+$/.test(path)) {
        showMessage('路径只能包含字母、数字、横线、下划线和斜杠', 'error');
        uploadButton.disabled = true;
    } else {
        message.textContent = '';
        message.className = 'message';
        updateUploadButtonState();
    }
});

// UI Helpers
function showMessage(text, type) {
    message.textContent = text;
    message.className = 'message ' + type;
    debug(`[${type.toUpperCase()}] ${text}`);
}

// Check network status periodically
setInterval(() => {
    const networkStatus = document.getElementById('networkStatus');
    if (networkStatus) {
        const isOnline = navigator.onLine;
        networkStatus.textContent = `网络状态: ${isOnline ? '在线' : '离线'}`;
        networkStatus.className = `network-status ${isOnline ? 'online' : 'offline'}`;
    }
}, 5000);

// Initial setup
debug('Application starting...');
loadSavedConfig();
updateUploadButtonState();

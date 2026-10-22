const API = '';
let currentMode = 'std';
let uploadedImage = null;
let currentJobId = null;
let pollingInterval = null;

const $ = (id) => document.getElementById(id);

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    $('duration').value = currentMode === 'pro' ? '10' : '5';
  });
});

$('promptInput').addEventListener('input', (e) => {
  $('charCount').textContent = `${e.target.value.length} / 500`;
});

$('imageUpload').addEventListener('click', () => $('imageInput').click());

$('imageInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  uploadedImage = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    $('imagePreview').src = ev.target.result;
    $('imagePreview').style.display = 'block';
    $('uploadPlaceholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
});

$('generateBtn').addEventListener('click', async () => {
  const prompt = $('promptInput').value.trim();
  if (!prompt && !uploadedImage) {
    alert('⚠️ Décrivez votre vidéo ou ajoutez une image');
    return;
  }

  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('duration', $('duration').value);
  formData.append('aspectRatio', $('aspectRatio').value);
  formData.append('mode', currentMode);
  formData.append('negativePrompt', $('negativePrompt').value);
  if (uploadedImage) formData.append('image', uploadedImage);

  $('generateBtn').disabled = true;
  $('progressPanel').style.display = 'block';
  $('resultPanel').style.display = 'none';
  $('progressFill').style.width = '0%';
  $('progressPercent').textContent = '0%';

  try {
    const res = await fetch(`${API}/api/generate`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    currentJobId = data.jobId;
    startPolling(currentJobId);
  } catch (err) {
    alert('Erreur: ' + err.message);
    resetUI();
  }
});

function startPolling(jobId) {
  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API}/api/status/${jobId}`);
      const data = await res.json();
      $('progressFill').style.width = data.progress + '%';
      $('progressPercent').textContent = data.progress + '%';

      if (data.status === 'completed') {
        clearInterval(pollingInterval);
        showResult(data.resultUrl);
        loadHistory();
      } else if (data.status === 'failed') {
        clearInterval(pollingInterval);
        alert('❌ Échec de la génération');
        resetUI();
      }
    } catch (err) { console.error(err); }
  }, 1000);
}

function showResult(url) {
  $('progressPanel').style.display = 'none';
  $('resultPanel').style.display = 'block';
  $('resultVideo').src = url;
  $('generateBtn').disabled = false;

  $('downloadBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `kling-${Date.now()}.mp4`;
    a.target = '_blank';
    a.click();
  };

  $('regenerateBtn').onclick = () => {
    $('resultPanel').style.display = 'none';
    $('generateBtn').click();
  };
}

function resetUI() {
  $('generateBtn').disabled = false;
  $('progressPanel').style.display = 'none';
  if (pollingInterval) clearInterval(pollingInterval);
}

async function loadHistory() {
  try {
    const res = await fetch(`${API}/api/history`);
    const jobs = await res.json();
    const grid = $('historyGrid');
    if (jobs.length === 0) {
      grid.innerHTML = '<p class="empty-state">Aucune génération pour l\'instant</p>';
      return;
    }
    grid.innerHTML = jobs.map(job => `
      <div class="history-item" onclick="if('${job.resultUrl}') window.open('${job.resultUrl}', '_blank')">
        <div class="history-preview">${job.status === 'completed' ? '🎬' : '⏳'}</div>
        <div class="history-info">
          <div class="history-prompt" title="${escapeHtml(job.prompt || 'Sans titre')}">
            ${escapeHtml(job.prompt || 'Sans titre')}
          </div>
          <div class="history-meta">${job.mode === 'pro' ? '✨ Pro' : '🎬 Std'} · ${job.duration}s · ${job.status}</div>
        </div>
      </div>
    `).join('');
  } catch (err) { console.error(err); }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadHistory();

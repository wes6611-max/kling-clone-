require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

const jobs = new Map();

app.post('/api/generate', upload.single('image'), (req, res) => {
  const { prompt, duration, aspectRatio, mode, negativePrompt } = req.body;

  if (!prompt && !req.file) {
    return res.status(400).json({ error: 'Prompt ou image requis' });
  }

  const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  const job = {
    id: jobId,
    prompt,
    negativePrompt: negativePrompt || '',
    duration: parseInt(duration) || 5,
    aspectRatio: aspectRatio || '16:9',
    mode: mode || 'std',
    imagePath: req.file ? req.file.path : null,
    status: 'processing',
    progress: 0,
    createdAt: new Date().toISOString(),
    resultUrl: null,
    error: null
  };

  jobs.set(jobId, job);
  generateAgnesVideo(jobId);

  res.json({
    jobId,
    status: 'processing',
    estimatedTime: job.mode === 'pro' ? 180 : 90
  });
});

async function generateAgnesVideo(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const AGNES_API_KEY = process.env.AGNES_API_KEY;
  const BASE_URL = 'https://apihub.agnes-ai.com/v1';
  const MODEL = 'agnes-video-2.5-flash';

  if (!AGNES_API_KEY) {
    job.status = 'failed';
    job.error = 'Clé API Agnes manquante';
    return;
  }

  try {
    const createRes = await fetch(`${BASE_URL}/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AGNES_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: job.prompt,
        seconds: String(job.duration),
        size: '720P',
        aspect_ratio: job.aspectRatio,
        mode: 'text'
      })
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      throw new Error(createData.message || `Erreur création: ${createRes.status}`);
    }

    const videoId = createData.video_id;
    if (!videoId) throw new Error('Pas de video_id reçu');

    job.apiVideoId = videoId;
    job.progress = 5;

    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await fetch(
          `https://apihub.agnes-ai.com/agnesapi?video_id=${videoId}&model_name=${MODEL}`,
          { headers: { 'Authorization': `Bearer ${AGNES_API_KEY}` } }
        );
        const statusData = await statusRes.json();

        if (statusData.progress) {
          job.progress = Math.min(statusData.progress, 99);
        }

        if (statusData.status === 'completed') {
          clearInterval(pollInterval);
          job.status = 'completed';
          job.progress = 100;
          job.resultUrl = statusData.url || statusData.video_url || statusData.data?.url;
        } else if (statusData.status === 'failed' || statusData.status === 'error') {
          clearInterval(pollInterval);
          job.status = 'failed';
          job.error = statusData.error?.message || statusData.message || 'Échec de la génération';
        }
      } catch (err) {
        clearInterval(pollInterval);
        job.status = 'failed';
        job.error = err.message;
      }
    }, 3000);

    setTimeout(() => clearInterval(pollInterval), 10 * 60 * 1000);

  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    console.error('Erreur Agnes:', error.message);
  }
}

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    resultUrl: job.resultUrl,
    prompt: job.prompt,
    mode: job.mode,
    duration: job.duration
  });
});

app.get('/api/history', (req, res) => {
  const allJobs = Array.from(jobs.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  res.json(allJobs);
});

app.listen(PORT, () => {
  console.log(`🎬 Kling Clone lancé sur http://localhost:${PORT}`);
});

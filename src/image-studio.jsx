import React, { useEffect, useState } from 'react';

export function ImageStudio({ api }) {
  const [health, setHealth] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState(1024);
  const [job, setJob] = useState(() => { try { return JSON.parse(sessionStorage.getItem("image-studio-job") || "null"); } catch { return null; } });
  useEffect(() => { if (job) sessionStorage.setItem("image-studio-job", JSON.stringify(job)); }, [job]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try { const value = await api('/api/images/health'); if (!disposed) setHealth(value); }
      catch { if (!disposed) setHealth({state:'offline'}); }
    };
    poll(); const timer = setInterval(poll, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!job?.id || ['complete','error'].includes(job.state)) return;
    let disposed = false;
    const timer = setInterval(async () => {
      try { const value = await api(`/api/images/jobs/${job.id}`); if (!disposed) setJob(value); }
      catch (e) { if (!disposed) { setError(e.message); setJob(current => ({...current, state:"error", error:e.message})); } }
    }, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [job?.id, job?.state]);
  async function generate(event) {
    event.preventDefault(); setPending(true); setError('');
    try { setJob(await api('/api/images/jobs', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:prompt.trim(),size:Number(size),steps:40,seed:42})})); }
    catch(e) { setError(e.message); } finally { setPending(false); }
  }
  const busy = pending || health?.busy || (job && !['complete','error'].includes(job.state));
  return <section className="panel image-studio">
    <div className="panel-title"><div><span className="eyebrow">Local image generation</span><h2>Qwen Image 2.1</h2><p>Create images on your DGX Spark. This service is separate from your chat model.</p></div><strong aria-live="polite">{health?.state || 'Checking'}</strong></div>
    <p>Research and evaluation use. Commercial use requires a separate Qwen license.</p>
    <form onSubmit={generate} className="image-studio-form">
      <label htmlFor="image-prompt">Describe your image</label>
      <textarea id="image-prompt" rows={5} maxLength={4000} required value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="A watercolor mountain landscape at sunrise…" />
      <div className="image-studio-actions"><label>Resolution <select value={size} onChange={e=>setSize(e.target.value)}><option value={512}>512 × 512 · Preview</option><option value={1024}>1024 × 1024</option><option value={2048}>2048 × 2048</option></select></label><button className="primary" disabled={busy || health?.state!=='ready' || !prompt.trim()}>{busy ? 'Generating…' : 'Generate image'}</button></div>
    </form>
    {(error || job?.error || health?.error) && <p role="alert" className="error-banner">{error || job?.error || health?.error}</p>}
    {job && <p aria-live="polite">{job.state === 'complete' ? `Completed in ${job.seconds}s` : `${job.state} · ${job.progress || 0}%`}</p>}
    {job?.state === 'complete' && <div className="image-studio-result"><img src={`/api/images/images/${job.id}`} alt={prompt} /><a href={`/api/images/images/${job.id}`} download={`qwen-image-${job.id}.png`}>Download PNG</a></div>}
    <p className="muted">Use Model Controller to start or stop the Qwen Image service. Generation can take several minutes.</p>
  </section>;
}

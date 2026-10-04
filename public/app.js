const chatForm = document.querySelector('#chat-form');
const messageInput = document.querySelector('#message-input');
const chatScroll = document.querySelector('#chat-scroll');
const sendButton = document.querySelector('#send-button');
const toast = document.querySelector('#toast');
const contactDialog = document.querySelector('#contact-dialog');
const noticeDialog = document.querySelector('#notice-dialog');
const sosDialog = document.querySelector('#sos-dialog');
const voiceButton = document.querySelector('#voice-button');
const voiceButtonLabel = document.querySelector('#voice-button-label');
const voiceStatus = document.querySelector('#voice-status');
const safeWordInput = document.querySelector('#safe-word-input');
const voiceTriggersInput = document.querySelector('#voice-triggers-input');
const autoRecordSetting = document.querySelector('#auto-record-setting');
const analyzeRecordingButton = document.querySelector('#analyze-recording-button');
const shareRecordingButton = document.querySelector('#share-recording-button');
const analysisDialog = document.querySelector('#analysis-dialog');
const analysisForm = document.querySelector('#analysis-form');
const analysisResult = document.querySelector('#analysis-result');
const analysisStatus = document.querySelector('#analysis-status');
const sosRecordingStatus = document.querySelector('#sos-recording-status');
const stopSosRecordingButton = document.querySelector('#stop-sos-recording');
const history = [];
let mediaRecorder;
let recordingChunks = [];
let toastTimeout;
let voiceRecognition;
let voiceListening = false;
let lastRecordingBlob;
let lastRecordingFilename;
let recordingSize = 0;
const maxRecordingBytes = 20 * 1024 * 1024;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 3600);
}

function addMessage(text, role, time = 'just now') {
  const article = document.createElement('article');
  article.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = 'a';
    article.append(avatar);
  }
  const content = document.createElement('div');
  content.className = 'message-content';
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  const timestamp = document.createElement('time');
  timestamp.textContent = `${role === 'user' ? 'You' : 'Boundary Buddy'} · ${time}`;
  content.append(paragraph, timestamp);
  article.append(content);
  chatScroll.append(article);
  article.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message || sendButton.disabled) return;
  const savedPhrase = getPrivatePhrase();
  const safeWordActivated = Boolean(savedPhrase && message.toLowerCase() === savedPhrase.toLowerCase());
  const outgoingMessage = safeWordActivated ? 'I need immediate help now.' : message;
  addMessage(safeWordActivated ? 'Quick SOS requested.' : message, 'user');
  history.push({ role: 'user', content: outgoingMessage });
  messageInput.value = '';
  sendButton.disabled = true;
  sendButton.textContent = '…';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: outgoingMessage, history: history.slice(-8, -1), safeWordActivated }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not send your message.');
    addMessage(data.reply, 'assistant');
    history.push({ role: 'assistant', content: data.reply });
    if (data.emergency || data.ui_takeover === 'EMERGENCY_DRAWER_ACTIVE' || data.trigger_911_hook === true) openSOS();
  } catch (error) {
    addMessage(error.message, 'assistant');
  } finally {
    sendButton.disabled = false;
    sendButton.innerHTML = 'Send <span>↗</span>';
    messageInput.focus();
  }
});

document.querySelectorAll('.prompt-chip').forEach((button) => {
  button.addEventListener('click', () => {
    messageInput.value = button.textContent;
    messageInput.focus();
  });
});

function getTrustedContact() {
  try { return JSON.parse(localStorage.getItem('aura-trusted-contact') || 'null'); }
  catch { return null; }
}

function updateContactSummary() {
  const contact = getTrustedContact();
  document.querySelector('#contact-summary').textContent = contact?.name ? `Saved · ${contact.name}` : 'Add someone you trust';
}

function openContactDialog() {
  const contact = getTrustedContact();
  document.querySelector('#contact-name').value = contact?.name || '';
  document.querySelector('#contact-phone').value = contact?.phone || '';
  contactDialog.showModal();
}

document.querySelector('#contact-button').addEventListener('click', openContactDialog);
document.querySelector('#contacts-nav').addEventListener('click', openContactDialog);
document.querySelector('#contact-form').addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const name = document.querySelector('#contact-name').value.trim();
  const phone = document.querySelector('#contact-phone').value.trim();
  if (!name || !phone) {
    showToast('Add a name and phone number to save this person.');
    return;
  }
  localStorage.setItem('aura-trusted-contact', JSON.stringify({ name, phone }));
  updateContactSummary();
  contactDialog.close();
  showToast(`${name} is saved on this device.`);
});

document.querySelector('#location-button').addEventListener('click', () => {
  const contact = getTrustedContact();
  if (!contact?.phone) {
    showToast('Add a trusted person first.');
    openContactDialog();
    return;
  }
  if (!navigator.geolocation) {
    showToast('Location sharing is not supported by this browser.');
    return;
  }
  showToast('Waiting for your location permission…');
  navigator.geolocation.getCurrentPosition((position) => {
    const { latitude, longitude } = position.coords;
    const mapUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
    const body = encodeURIComponent(`Hi ${contact.name}, I wanted to share my current location with you: ${mapUrl}`);
    window.location.href = `sms:${encodeURIComponent(contact.phone)}?body=${body}`;
    showToast('Review and send the location message in your messaging app.');
  }, (error) => {
    showToast(error.code === error.PERMISSION_DENIED ? 'Location permission was not granted.' : 'Could not get your location. Try again somewhere with a clear signal.');
  }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
});

const recordButton = document.querySelector('#record-button');
const recordTitle = document.querySelector('#record-title');
const recordCaption = document.querySelector('#record-caption');
const recordAction = document.querySelector('#record-action');
const recordingNote = document.querySelector('#recording-note');

function updateSOSRecordingStatus(message, recording = false) {
  sosRecordingStatus.textContent = message;
  sosRecordingStatus.hidden = !message;
  stopSosRecordingButton.hidden = !recording;
}

async function startRecording({ safetyTriggered = false } = {}) {
  if (mediaRecorder?.state === 'recording') return false;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showToast('Audio recording is not available in this browser.');
    if (safetyTriggered) updateSOSRecordingStatus('Automatic recording is not supported here. SOS is still available.');
    return false;
  }
  try {
    if (safetyTriggered) updateSOSRecordingStatus('Waiting for microphone permission…');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    recordingSize = 0;
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (!event.data.size) return;
      recordingSize += event.data.size;
      if (recordingSize > maxRecordingBytes) {
        showToast('Recording reached the 20 MB limit and was stopped.');
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
        return;
      }
      recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', () => {
      stream.getTracks().forEach((track) => track.stop());
      recordButton.classList.remove('is-recording');
      recordTitle.textContent = 'Recording saved';
      recordCaption.textContent = 'Stored in your browser downloads';
      recordAction.textContent = 'Start again';
      const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      lastRecordingBlob = blob;
      lastRecordingFilename = `aura-recording-${new Date().toISOString().replaceAll(':', '-')}.${(blob.type.split('/')[1] || 'webm').split(';')[0]}`;
      recordingNote.textContent = 'Saved to downloads. Analyze or share only when you choose.';
      analyzeRecordingButton.hidden = false;
      shareRecordingButton.hidden = false;
      analysisResult.hidden = true;
      analysisStatus.textContent = '';
      updateSOSRecordingStatus('Recording stopped. Saved to this device.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = lastRecordingFilename;
      link.click();
      URL.revokeObjectURL(url);
    }, { once: true });
    mediaRecorder.start(1_000);
    recordButton.classList.add('is-recording');
    recordTitle.textContent = 'Recording now';
    recordCaption.textContent = 'Microphone active · this device only';
    recordAction.textContent = 'Stop';
    recordingNote.textContent = 'Recording is active. Press Stop to save it to downloads.';
    if (safetyTriggered) updateSOSRecordingStatus('Recording is on. Stop it here or in Keep a record.', true);
    return true;
  } catch {
    showToast('Microphone permission was not granted.');
    if (safetyTriggered) updateSOSRecordingStatus('Microphone permission was not granted. SOS is still available.');
    return false;
  }
}

recordButton.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  else void startRecording();
});

stopSosRecordingButton.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
});

async function analyzeRecording() {
  if (!lastRecordingBlob) return;
  analyzeRecordingButton.disabled = true;
  analysisStatus.textContent = 'Uploading recording to NVIDIA for transcription and review…';
  try {
    const response = await fetch('/api/analyze-recording', {
      method: 'POST',
      headers: { 'Content-Type': lastRecordingBlob.type || 'audio/webm' },
      body: lastRecordingBlob,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not analyze this recording.');
    document.querySelector('#analysis-summary').textContent = data.summary;
    document.querySelector('#analysis-transcript').textContent = data.transcript;
    analysisResult.hidden = false;
    analysisStatus.textContent = 'Analysis complete. The recording remains in your downloads.';
  } catch (error) {
    analysisStatus.textContent = error.message;
  } finally {
    analyzeRecordingButton.disabled = false;
  }
}

analyzeRecordingButton.addEventListener('click', () => {
  if (lastRecordingBlob) analysisDialog.showModal();
});

analysisForm.addEventListener('submit', (event) => {
  if (event.submitter?.id !== 'confirm-analysis') return;
  event.preventDefault();
  analysisDialog.close();
  void analyzeRecording();
});

shareRecordingButton.addEventListener('click', async () => {
  if (!lastRecordingBlob) return;
  const contact = getTrustedContact();
  if (!contact?.name) {
    showToast('Add a trusted person before sharing this recording.');
    openContactDialog();
    return;
  }
  const file = new File([lastRecordingBlob], lastRecordingFilename, { type: lastRecordingBlob.type || 'audio/webm' });
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    showToast('Device sharing is not supported here. The recording is in downloads for you to attach manually.');
    return;
  }
  try {
    await navigator.share({
      files: [file],
      title: 'Aura recording',
      text: `Choose ${contact.name} in the device share sheet if you want to send them this recording.`,
    });
  } catch (error) {
    if (error.name !== 'AbortError') showToast('Could not open device sharing. The recording is in downloads.');
  }
});

function openSOS() {
  if (voiceListening) stopVoiceSOS('Voice SOS stopped while SOS is open.');
  if (!sosDialog.open) sosDialog.showModal();
}

function getVoiceTriggers() {
  let savedTriggers = '';
  try { savedTriggers = localStorage.getItem('aura-voice-triggers') || ''; }
  catch { return ['help']; }
  return ['help', ...savedTriggers.split(',').map((word) => word.trim().toLowerCase()).filter((word) => word.length >= 2)].slice(0, 6);
}

function stopVoiceSOS(message = 'Voice SOS is off.') {
  voiceListening = false;
  voiceButton.setAttribute('aria-pressed', 'false');
  voiceButtonLabel.textContent = 'Start voice SOS';
  voiceStatus.textContent = message;
  try { voiceRecognition?.stop(); }
  catch { /* Recognition may already have stopped. */ }
}

function startVoiceSOS() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceStatus.textContent = 'Voice activation is not supported in this browser. Use the SOS button or keyboard shortcut.';
    voiceButton.disabled = true;
    return;
  }

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = navigator.language || 'en-US';
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = false;
  voiceRecognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const matched = getVoiceTriggers().some((word) => {
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|\\s)${escapedWord}(?:$|\\s)`, 'i').test(transcript);
    });
    if (matched) {
      stopVoiceSOS('Voice trigger heard. SOS is open.');
      if (isAutoRecordingEnabled()) void startRecording({ safetyTriggered: true });
      openSOS();
    }
  };
  voiceRecognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      stopVoiceSOS('Microphone permission was not granted.');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      stopVoiceSOS('Voice activation stopped. Use the SOS button if needed.');
    }
  };
  voiceRecognition.onend = () => {
    if (voiceListening && document.visibilityState === 'visible') {
      setTimeout(() => {
        if (voiceListening && document.visibilityState === 'visible') {
          try { voiceRecognition.start(); }
          catch { stopVoiceSOS('Voice activation stopped. Start it again if needed.'); }
        }
      }, 250);
    }
  };

  try {
    voiceRecognition.start();
    voiceListening = true;
    voiceButton.setAttribute('aria-pressed', 'true');
    voiceButtonLabel.textContent = 'Stop voice SOS';
    voiceStatus.textContent = `Listening for “${getVoiceTriggers().join('” or “')}”. Aura must stay open.`;
  } catch {
    stopVoiceSOS('Could not start voice activation. Check microphone permission.');
  }
}

voiceButton.addEventListener('click', () => {
  if (voiceListening) stopVoiceSOS();
  else startVoiceSOS();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    if (voiceListening) stopVoiceSOS('Voice SOS stopped because Aura is no longer visible.');
    if (mediaRecorder?.state === 'recording') {
      recordingNote.textContent = 'Recording stopped because Aura is no longer visible.';
      mediaRecorder.stop();
    }
  }
});

if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
  voiceButton.disabled = true;
  voiceStatus.textContent = 'Voice activation is not supported in this browser. Use the SOS button or keyboard shortcut.';
}

function isAutoRecordingEnabled() {
  try { return localStorage.getItem('aura-auto-record-after-voice') === 'true'; }
  catch { return false; }
}

document.querySelector('#sos-button').addEventListener('click', openSOS);
document.querySelector('#quick-trigger').addEventListener('click', openSOS);
document.addEventListener('keydown', (event) => {
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    openSOS();
  }
});

document.querySelector('#privacy-button').addEventListener('click', () => {
  safeWordInput.value = getPrivatePhrase();
  voiceTriggersInput.value = getVoiceTriggers().filter((word) => word !== 'help').join(', ');
  autoRecordSetting.checked = isAutoRecordingEnabled();
  noticeDialog.showModal();
});
document.querySelector('#privacy-form').addEventListener('submit', (event) => {
  if (event.submitter?.id !== 'save-safe-word') return;
  event.preventDefault();
  const phrase = safeWordInput.value.trim();
  const customTriggers = voiceTriggersInput.value.split(',').map((word) => word.trim()).filter((word) => word.length >= 2).slice(0, 5);
  try {
    if (phrase) localStorage.setItem('aura-private-chat-phrase', phrase);
    else localStorage.removeItem('aura-private-chat-phrase');
    if (customTriggers.length) localStorage.setItem('aura-voice-triggers', customTriggers.join(', '));
    else localStorage.removeItem('aura-voice-triggers');
    localStorage.setItem('aura-auto-record-after-voice', String(autoRecordSetting.checked));
  } catch {
    showToast('Browser storage is unavailable. Settings were not saved.');
    return;
  }
  noticeDialog.close();
  showToast('Privacy and voice settings saved in this browser.');
});

function getPrivatePhrase() {
  try { return localStorage.getItem('aura-private-chat-phrase') || ''; }
  catch { return ''; }
}

updateContactSummary();
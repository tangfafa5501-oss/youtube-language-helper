import './style.css';
const button = document.querySelector<HTMLButtonElement>('#allow')!;
const status = document.querySelector<HTMLElement>('#status')!;
button.onclick = async () => {
  button.disabled = true; status.textContent = '正在请求麦克风权限…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    status.textContent = '授权成功，可以返回跟读练习。';
    await browser.runtime.sendMessage({ type: 'practice-permission', nonce: new URLSearchParams(location.search).get('nonce'), granted: true });
  } catch { status.textContent = '未获得麦克风权限。请允许访问后重试。'; button.disabled = false;
    void browser.runtime.sendMessage({ type: 'practice-permission', nonce: new URLSearchParams(location.search).get('nonce'), granted: false }); }
};

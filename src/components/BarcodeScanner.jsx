import React, { useEffect, useRef, useState } from 'react';
import { isBarcode } from '../services/food';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/**
 * Camera barcode scanner. Uses the browser's own BarcodeDetector where it exists (Chrome on Android);
 * elsewhere (Safari, Firefox) it loads a small decoder on demand. A barcode can always be typed in instead.
 */
export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('starting'); // starting | scanning | error
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const done = useRef(false);

  useEffect(() => {
    let stream = null;
    let timer = null;
    let zxingControls = null;
    let cancelled = false;

    const finish = (code) => {
      if (done.current || !isBarcode(code)) return;
      done.current = true;
      navigator.vibrate?.(60);
      onDetected(code);
    };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setError("This browser can't use the camera here. Type the barcode instead.");
        return;
      }
      try {
        const native = 'BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats?.())?.includes?.('ean_13');
        if (native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          if (cancelled) return;
          const video = videoRef.current;
          video.srcObject = stream;
          await video.play();
          setStatus('scanning');
          const detector = new window.BarcodeDetector({ formats: FORMATS });
          const tick = async () => {
            if (cancelled || done.current) return;
            try {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) return finish(found[0].rawValue);
            } catch {
              /* frame not ready */
            }
            timer = setTimeout(tick, 200);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (cancelled) return;
          const reader = new BrowserMultiFormatReader();
          setStatus('scanning');
          zxingControls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, videoRef.current, (result) => {
            if (result) finish(result.getText());
          });
        }
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or type the barcode.'
            : "Couldn't start the camera. Type the barcode instead."
        );
      }
    }
    start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      zxingControls?.stop?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="scanner">
      <div className="scanner-view">
        <video ref={videoRef} muted playsInline aria-label="Camera view" />
        {status === 'scanning' && <div className="scanner-frame" aria-hidden="true" />}
        {status === 'starting' && <p className="scanner-msg">Starting camera…</p>}
        {status === 'error' && <p className="scanner-msg" role="alert">{error}</p>}
      </div>
      {status === 'scanning' && <p className="muted small">Point at the barcode on the pack. It scans on its own.</p>}
      <form
        className="ai-ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (isBarcode(typed)) onDetected(typed.trim());
        }}
      >
        <input type="text" inputMode="numeric" placeholder="Or type the barcode" aria-label="Barcode number" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 14))} />
        <button type="submit" className="secondary-btn" disabled={!isBarcode(typed)}>Look up</button>
      </form>
      <button type="button" className="link-btn" onClick={onClose}>Cancel</button>
    </div>
  );
}

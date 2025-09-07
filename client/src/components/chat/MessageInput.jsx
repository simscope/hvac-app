// client/src/components/chat/MessageInput.jsx
import React, { useRef, useState } from 'react';

function hasTransparency(imageData) {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

async function compressImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const ratio = width / height;

        if (width > height && width > maxSide) {
          width = maxSide;
          height = Math.round(width / ratio);
        } else if (height >= width && height > maxSide) {
          height = maxSide;
          width = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Проверяем прозрачность исходной PNG
        let targetType = 'image/jpeg';
        if (file.type === 'image/png') {
          const imgData = ctx.getImageData(0, 0, width, height);
          if (hasTransparency(imgData)) {
            // оставляем PNG, но всё равно уменьшим по размерам
            canvas.toBlob((blob) => {
              resolve(new File([blob], file.name, { type: 'image/png' }));
            }, 'image/png');
            return;
          }
        }

        canvas.toBlob((blob) => {
          const name = file.name.replace(/\.(png|jpg|jpeg|webp)$/i, '.jpg');
          resolve(new File([blob], name, { type: targetType }));
        }, targetType, quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function MessageInput({ chatId, currentUser, disabledSend = false, onTyping, onSend }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const fileRef = useRef(null);

  const handlePick = () => fileRef.current?.click();

  const handleFiles = async (fileList) => {
    const arr = Array.from(fileList || []);
    const processed = [];
    for (const f of arr) {
      if (f.type.startsWith('image/')) {
        // сжимаем изображения
        try {
          const small = await compressImage(f, 1600, 0.82);
          processed.push(small);
        } catch {
          processed.push(f); // на всякий случай оригинал
        }
      } else {
        processed.push(f);
      }
    }
    setFiles(prev => [...prev, ...processed]);
  };

  const submit = async () => {
    if (!chatId || disabledSend) return;
    const textTrim = text.trim();
    if (!textTrim && files.length === 0) return;

    try {
      await onSend?.({ text: textTrim, files });
      setText('');
      setFiles([]);
    } catch (e) {
      console.error('send failed', e);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else {
      // уведомляем "печатает…" только если можно отправлять
      if (!disabledSend) onTyping?.(currentUser?.user_metadata?.name || 'Сотрудник');
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'end' }}>
      <button onClick={handlePick} disabled={disabledSend}>📎</button>
      <textarea
       style={{ width: '100%', height: 48, resize: 'vertical' }}
   placeholder="Напиши сообщение… (перетащи файлы сюда)"
   value={text}
   onChange={(e) => setText(e.target.value)}
   onKeyDown={onKeyDown}
   onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
   onDragOver={(e) => e.preventDefault()}
      />
      <button onClick={submit} disabled={disabledSend || (!text.trim() && files.length === 0)}>Отправить</button>

      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* превью прикреплённых файлов */}
      {!!files.length && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {files.map((f, idx) => (
            <div key={idx} style={{ border: '1px solid #eee', padding: 6, borderRadius: 6 }}>
              {f.type.startsWith('image/') ? (
                <img
                  src={URL.createObjectURL(f)}
                  alt={f.name}
                  style={{ maxWidth: 160, maxHeight: 120, display: 'block' }}
                />
              ) : (
                <span>{f.name}</span>
              )}
              <div style={{ fontSize: 11, color: '#777' }}>{Math.round(f.size / 1024)} KB</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

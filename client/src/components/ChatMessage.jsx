export default function ChatMessage({ msg }) {
  const isImage = msg?.file_type?.startsWith('image/');

  return (
    <div style={{ marginBottom: 12, padding: 8, borderRadius: 8, background: '#f7f7f7' }}>
      {msg?.text && (
        <div style={{ marginBottom: msg?.file_url ? 6 : 0 }}>
          {msg.text}
        </div>
      )}

      {msg?.file_url && (
        <div>
          {isImage ? (
            <a href={msg.file_url} target="_blank" rel="noreferrer">
              <img
                src={msg.file_url}
                alt={msg.file_name || 'image'}
                style={{ maxWidth: 260, borderRadius: 6, display: 'block' }}
              />
            </a>
          ) : (
            <a href={msg.file_url} target="_blank" rel="noreferrer">
              📎 {msg.file_name || 'Файл'}
              {typeof msg.file_size === 'number' && (
                <> ({Math.round(msg.file_size / 1024)} Кб)</>
              )}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

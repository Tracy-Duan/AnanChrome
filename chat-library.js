/* One key per conversation avoids overwriting other windows' unrelated chats. */
var AnanChatLibrary = (() => {
  const PREFIX = 'anan-chat:';
  const newId = () => crypto.randomUUID();
  const key = id => PREFIX + id;
  function entry(id, snapshot, createdAt = Date.now()) {
    const first = snapshot.history.find(m => m.role === 'user');
    const title = String(first?.display || first?.content || snapshot.pages[0]?.title || '新对话')
      .replace(/\s+/g, ' ').trim().slice(0, 64);
    return { id, title, createdAt, updatedAt: Date.now(), conversation: snapshot };
  }
  function list(data) {
    return Object.entries(data).filter(([k, v]) => k.startsWith(PREFIX) && v?.id &&
      k === key(v.id) && v.conversation?.version === 1).map(([, v]) => v)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return { PREFIX, newId, key, entry, list };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AnanChatLibrary;

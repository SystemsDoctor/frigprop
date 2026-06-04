let _data = null;

async function _load() {
  if (_data) return;
  const res = await fetch("./data/refrigerants.json");
  if (!res.ok) throw new Error(`Failed to load refrigerants.json: ${res.status}`);
  _data = await res.json();
}

export async function getRefrigerantList() {
  await _load();
  return Object.keys(_data);
}

export async function getRefrigerantInfo(key) {
  await _load();
  if (!_data[key]) throw new Error(`Unknown refrigerant: ${key}`);
  return _data[key];
}

import { Euler, Quaternion } from 'three';

export function orientation(values, mode, channels, unit = 'deg') {
  const input = channels.slice(0, mode === 'quaternion' ? 4 : 3).map(index => values[index]);
  if (input.some(value => !Number.isFinite(value))) return null;
  if (mode === 'quaternion') {
    const [w, x, y, z] = input, norm = Math.hypot(w, x, y, z);
    if (norm < 1e-9) return null;
    return new Quaternion(x / norm, y / norm, z / norm, w / norm);
  }
  const scale = unit === 'rad' ? 1 : Math.PI / 180;
  return new Quaternion().setFromEuler(new Euler(input[0] * scale, input[1] * scale, input[2] * scale, 'ZYX'));
}

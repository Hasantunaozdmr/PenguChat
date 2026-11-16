// 📡 Telefondan yayın: Android'deki PenguLive görünümü (kamera önizlemesi + Twitch / Kick'e yayın)
import { requireNativeModule, requireNativeView } from 'expo';

export const PenguLiveView = requireNativeView('PenguLive');
const mod = requireNativeModule('PenguLive');
// Galeriden seçilen resmi uygulamanın kendi klasörüne kopyalar → dosya yolu
export const importImage = (uri) => mod.importImage(uri);
export const deleteImage = (path) => mod.deleteImage(path);

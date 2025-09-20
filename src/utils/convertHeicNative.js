// src/utils/convertHeicNative.js
import * as ImageManipulator from "expo-image-manipulator";

// Принимает localUri (может указывать на .heic), возвращает { uri, mime, name }
export async function ensureJpeg(localUri, originalName = "image.jpg") {
  // Если расширение .heic/.heif — конвертируем. Если нет — всё равно пережмём в JPEG,
  // чтобы у нас всегда был предсказуемый формат для веба.
  const res = await ImageManipulator.manipulateAsync(
    localUri,
    [], // без изменений по геометрии
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
  );

  const outName = originalName.replace(/\.(heic|heif)$/i, ".jpg");
  return { uri: res.uri, mime: "image/jpeg", name: outName.endsWith(".jpg") ? outName : `${outName}.jpg` };
}

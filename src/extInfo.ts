// Sugestão do que cada extensão "desconhecida" provavelmente é / onde se usa.
// Pro grupo "Outros": agrupar por extensão com uma dica pro editor/designer.
// O texto vem do dicionário i18n (ext.<extensão>), traduzido PT/EN/ES.
import { t } from "./i18n";

// Extensões com descrição própria no dicionário (ext.<chave>). As que não estão aqui
// caem em ext.unknown ("Tipo não reconhecido" / "Unrecognized type" / "Tipo no reconocido").
const KNOWN = new Set([
  "aep", "aepx", "ffx", "aet", "mogrt", "prproj", "proj", "drp", "drt", "dra",
  "cube", "3dl", "dat", "look", "xmp", "psd", "psb", "ai", "eps", "indd",
  "afdesign", "afphoto", "afpub", "obj", "fbx", "c4d", "blend", "gltf", "glb",
  "zip", "rar", "7z", "sbsar", "json", "fnt", "sesx",
]);

export function extSuggestion(ext: string): string {
  const e = ext.toLowerCase();
  return KNOWN.has(e) ? t(`ext.${e}`) : t("ext.unknown");
}

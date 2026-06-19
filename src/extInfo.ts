// Sugestão do que cada extensão "desconhecida" provavelmente é / onde se usa.
// Pro grupo "Outros": agrupar por extensão com uma dica pro editor/designer.
const MAP: Record<string, string> = {
  // After Effects
  aep: "After Effects — projeto",
  aepx: "After Effects — projeto (XML)",
  ffx: "After Effects — preset de animação",
  aet: "After Effects — template",
  mogrt: "Motion Graphics Template (Premiere/AE)",
  // Premiere / edição
  prproj: "Premiere Pro — projeto",
  proj: "Projeto de edição",
  // DaVinci
  drp: "DaVinci Resolve — projeto",
  drt: "DaVinci Resolve — template de timeline",
  dra: "DaVinci Resolve — arquivo de pacote",
  // Color / LUT
  cube: "LUT — tabela de cor (DaVinci/Premiere)",
  "3dl": "LUT — tabela de cor 3D",
  dat: "LUT / dados de cor",
  look: "LUT/Look (DaVinci)",
  xmp: "Metadados/preset de cor (Camera Raw)",
  // Adobe imagem/vetor
  psd: "Photoshop — documento em camadas",
  psb: "Photoshop — documento grande",
  ai: "Illustrator — vetor",
  eps: "Vetor (Illustrator)",
  indd: "InDesign — documento",
  // Affinity
  afdesign: "Affinity Designer — documento",
  afphoto: "Affinity Photo — documento",
  afpub: "Affinity Publisher — documento",
  // 3D / motion
  obj: "Modelo 3D",
  fbx: "Modelo/animação 3D",
  c4d: "Cinema 4D — projeto",
  blend: "Blender — projeto",
  gltf: "Modelo 3D (glTF)",
  glb: "Modelo 3D (glTF binário)",
  // pacotes / outros
  zip: "Pacote compactado",
  rar: "Pacote compactado",
  "7z": "Pacote compactado",
  sbsar: "Substance — material",
  json: "Dados/configuração (Lottie? preset?)",
  // fontes (caso caiam aqui)
  fnt: "Fonte",
  // áudio de projeto
  sesx: "Audition — sessão",
};

export function extSuggestion(ext: string): string {
  return MAP[ext.toLowerCase()] ?? "Tipo não reconhecido";
}

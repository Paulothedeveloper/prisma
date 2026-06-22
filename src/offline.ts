// Catálogo de drives offline: guarda as raízes indexadas que estão desconectadas agora.
// Um asset é "offline" se o caminho dele começa por uma raiz offline. As miniaturas ficam
// em cache local, então o item segue navegável mesmo com o HD fora.
let roots: string[] = [];

export function setOfflineRoots(r: string[]) {
  roots = r;
}

export function isOffline(path: string): boolean {
  return roots.length > 0 && roots.some((d) => path.startsWith(d));
}

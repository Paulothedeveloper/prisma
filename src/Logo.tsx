// Logo PRISMA — a logo real do Paulo (prisma "Dark Side of the Moon"), transparente.
import logoUrl from "./assets/logo.png";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="PRISMA"
      draggable={false}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}

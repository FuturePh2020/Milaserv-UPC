import Image from "next/image";

export function BrandLogo({ size = 36, showWordmark = false }: { size?: number; showWordmark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/branding/milaserv-logo.png"
        alt="Milaserv 360"
        width={size}
        height={size}
        className="shrink-0 rounded"
        priority
      />
      {showWordmark && <span className="text-lg font-semibold tracking-tight text-white">Milaserv 360</span>}
    </div>
  );
}

export function BrandLoadingScreen({ message = "Loading Milaserv 360..." }: { message?: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-brand-navy">
      <Image src="/branding/milaserv-logo.png" alt="Milaserv 360" width={72} height={72} className="animate-pulse" priority />
      <p className="text-sm text-white/70">{message}</p>
    </div>
  );
}

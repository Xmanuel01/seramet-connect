import { Logo } from "@/components/app/Logo";

export function StartupScreen() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-background px-6 text-foreground"
      aria-busy="true"
    >
      <div role="status" aria-label="Opening Seramet" className="flex flex-col items-center gap-5">
        <Logo compact />
        <h1
          className="text-[42px] leading-normal font-normal"
          style={{ fontFamily: '"Segoe Print", "Bradley Hand", cursive' }}
        >
          Seramet
        </h1>
      </div>
    </main>
  );
}

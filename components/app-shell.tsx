import { PrimaryNavigation } from "@/components/primary-navigation";

export function AppShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto grid min-h-screen max-w-[1600px] lg:grid-cols-[18rem_1fr]">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="border-b border-[var(--border)] bg-[rgb(7_17_14_/_85%)] p-5 backdrop-blur lg:min-h-screen lg:border-r lg:border-b-0 lg:p-7">
        <div className="mb-6">
          <p className="text-xs font-bold tracking-[0.22em] text-[var(--accent)] uppercase">
            Private intelligence
          </p>
          <p className="mt-2 text-xl font-semibold">DNA Racing</p>
        </div>
        <PrimaryNavigation />
      </aside>
      <main className="p-5 sm:p-8 lg:p-12" id="main-content">
        {children}
      </main>
    </div>
  );
}

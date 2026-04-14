import IntelNav from "@/components/intel-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <IntelNav />
      <div className="pb-24 md:pb-4">{children}</div>
    </>
  );
}

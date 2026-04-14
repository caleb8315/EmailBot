import IntelNav from "@/components/intel-nav";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <IntelNav />
      {children}
    </>
  );
}

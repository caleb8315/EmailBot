import IntelNav from "@/components/intel-nav";

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <IntelNav />
      {children}
    </>
  );
}

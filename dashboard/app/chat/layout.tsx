import IntelNav from "@/components/intel-nav";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <IntelNav />
      <div className="pb-24 md:pb-4">{children}</div>
    </>
  );
}

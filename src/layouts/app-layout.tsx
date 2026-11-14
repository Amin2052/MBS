import Sidebar from "@/components/layout/sidebar";
import Topbar from "@/components/layout/topbar";
import Content from "@/components/layout/content";

export default function AppLayout(): JSX.Element {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <Content />
      </div>
    </div>
  );
}
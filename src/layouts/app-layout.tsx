import Sidebar from "@/components/layout/sidebar";
import Topbar from "@/components/layout/topbar";
import Content from "@/components/layout/content";
import StatusBar from "@/components/layout/status-bar";

export default function AppLayout(): JSX.Element {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <Content />
        <StatusBar />
      </div>
    </div>
  );
}
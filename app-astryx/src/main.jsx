// Vantage on Astryx — entry point. Theme (neutral base + the Vantage identity
// overlay) wraps the Shell; the Shell routes to migrated pages by hash.
import { createRoot } from "react-dom/client";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./theme-vantage.css";
import { Shell } from "./shell.jsx";
import { CockpitPage } from "./pages/cockpit.jsx";

const PAGES = { cockpit: CockpitPage };

function App() {
  return (
    <Shell>
      {(page) => {
        const Page = PAGES[page] || CockpitPage;
        return <Page />;
      }}
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(
  <Theme theme={neutralTheme}><App /></Theme>
);

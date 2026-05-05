import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
// EN: i18n side-effect import — must precede any component that calls
// useTranslation() so i18next.init resolves before first render.
// 中: i18n 副作用 import 必须在所有 useTranslation() 调用前执行。
import "./i18n";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

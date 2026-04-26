import App from "./App.svelte";
import "@assets/styles/Core.css";
import { mount } from "svelte";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("App root element not found");
}

const app = mount(App, {
  target,
});

export default app;

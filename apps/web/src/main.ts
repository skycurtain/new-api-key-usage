import { createApp } from "vue";
import Antd from "antdv-next";
import "antdv-next/dist/reset.css";
import App from "./App.vue";
import "./assets/main.css";

const app = createApp(App);
app.use(Antd);
app.mount("#app");

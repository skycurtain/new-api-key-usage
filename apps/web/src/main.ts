import { createApp } from "vue";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import Antd from "antdv-next";
import "antdv-next/dist/reset.css";
import App from "./app.vue";
import { bindAuthRedirectToRouter, router } from "./router/index.ts";
import "./assets/main.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const app = createApp(App);
app.use(createPinia());
bindAuthRedirectToRouter();
app.use(router);
app.use(VueQueryPlugin, { queryClient });
app.use(Antd);
app.mount("#app");

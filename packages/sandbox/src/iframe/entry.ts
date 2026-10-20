import { startIframeRuntime } from "./runtime";

const root = document.querySelector<HTMLElement>("#patchsmith-root");
const channel = document.documentElement.dataset.patchsmithChannel;
if (root && channel !== undefined && channel !== null && channel !== "") {
  startIframeRuntime({ channel, root });
}

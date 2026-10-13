import { startIframeRuntime } from "./runtime";

const root = document.querySelector<HTMLElement>("#tailorkit-root");
const channel = document.documentElement.dataset.tailorkitChannel;
if (root && channel) {
  startIframeRuntime({ channel, root });
}

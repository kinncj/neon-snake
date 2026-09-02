import "./style.css";

const display = document.getElementById("display") as HTMLCanvasElement;

function fit(): void {
  const dpr = window.devicePixelRatio || 1;
  display.width = Math.round(display.clientWidth * dpr);
  display.height = Math.round(display.clientHeight * dpr);
  const ctx = display.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, display.width, display.height);
  }
}

window.addEventListener("resize", fit);
fit();

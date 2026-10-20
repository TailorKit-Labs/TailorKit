/* SPDX-License-Identifier: GPL-2.0-or-later
 * TailorKit demo platform for ozkl/doomgeneric. See LICENSE.
 */
#include <emscripten.h>
#include <stdint.h>
#include "doomgeneric.h"
#include "doomstat.h"

static struct { int pressed; unsigned char key; } keys[64];
static unsigned int read_key, write_key, frames, inputs;

void DG_Init(void) {}
void DG_DrawFrame(void) { frames++; }
/* The app calls exactly one engine tick at 35 Hz; no blocking sleep or main loop. */
void DG_SleepMs(uint32_t ms) { (void)ms; }
uint32_t DG_GetTicksMs(void) { return (uint32_t)emscripten_get_now(); }
void DG_SetWindowTitle(const char *title) { (void)title; }
int DG_GetKey(int *pressed, unsigned char *key) {
    if (read_key == write_key) return 0;
    *pressed = keys[read_key].pressed;
    *key = keys[read_key].key;
    read_key = (read_key + 1) % 64;
    inputs++;
    return 1;
}

EMSCRIPTEN_KEEPALIVE void dg_key(int pressed, int key) {
    unsigned int next = (write_key + 1) % 64;
    if (next == read_key) return;
    keys[write_key].pressed = pressed;
    keys[write_key].key = (unsigned char)key;
    write_key = next;
}
EMSCRIPTEN_KEEPALIVE void dg_init(void) {
    static char *args[] = { "doomgeneric", "-iwad", "/freedoom1.wad",
        "-warp", "1", "1", "-skill", "2", "-nosound" };
    singletics = true;
    doomgeneric_Create(sizeof(args) / sizeof(args[0]), args);
}
EMSCRIPTEN_KEEPALIVE void dg_tick(void) { doomgeneric_Tick(); }
EMSCRIPTEN_KEEPALIVE pixel_t *dg_framebuffer(void) { return DG_ScreenBuffer; }
EMSCRIPTEN_KEEPALIVE int dg_frames(void) { return frames; }
EMSCRIPTEN_KEEPALIVE int dg_inputs(void) { return inputs; }
EMSCRIPTEN_KEEPALIVE int dg_x(void) { return players[consoleplayer].mo ? players[consoleplayer].mo->x : 0; }
EMSCRIPTEN_KEEPALIVE int dg_y(void) { return players[consoleplayer].mo ? players[consoleplayer].mo->y : 0; }

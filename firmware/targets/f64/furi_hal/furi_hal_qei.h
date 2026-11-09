#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif
typedef void (*FuriHalQeiDeltaPosCallback)(int16_t delta_pos, void* context);

void furi_hal_qei_init(void);
void furi_hal_qei_deinit(void);
void furi_hal_qei_set_delta_pos_callback(FuriHalQeiDeltaPosCallback callback, void* context);

#ifdef __cplusplus
}
#endif

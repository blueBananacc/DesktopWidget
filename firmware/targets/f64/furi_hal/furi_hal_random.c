
#include "furi_hal_random.h"
#include <furi.h>
#include "furi_hal_bus.h"
#include "si91x_device.h"

#define TAG "RNG"

typedef enum {
    FuriHalRandomTypeRandom,
    FuriHalRandomTypePseudoRandom,
} FuriHalRandomType;

#define FURI_HAL_RANDOM_TYPE FuriHalRandomTypeRandom

static inline void furi_hal_random_enable(void) {
#if FURI_HAL_RANDOM_TYPE == FuriHalRandomTypeRandom
    HWRNG->HWRNG_CTRL_REG_b.HWRNG_RNG_ST = 1;
#else
    HWRNG->HWRNG_CTRL_REG_b.HWRNG_PRBS_ST = 1;
#endif
}

static inline void furi_hal_random_disable(void) {
    HWRNG->HWRNG_CTRL_REG = 0;
}

void furi_hal_random_init(void) {
    FURI_LOG_D(TAG, "Initializing RNG");

    // Enable RNG clock
    furi_hal_bus_enable(FuriHalBusHWRNG_PCLK);
}

void furi_hal_ramdom_deinit(void) {
    FURI_LOG_D(TAG, "Deinitializing RNG");
    // Disable RNG clock
    furi_hal_bus_disable(FuriHalBusHWRNG_PCLK);
}

uint32_t furi_hal_random_get(void) {
    furi_hal_random_enable();
    uint32_t rng = HWRNG->HWRNG_RAND_NUM_REG;
    furi_hal_random_disable();
    return rng;
}

void furi_hal_random_fill_buf(uint8_t* buf, uint32_t len) {
    furi_hal_random_enable();
    for(uint32_t i = 0; i < len; i += 4) {
        const uint32_t random_val = HWRNG->HWRNG_RAND_NUM_REG;
        uint8_t len_cur = ((i + 4) < len) ? (4) : (len - i);
        memcpy(&buf[i], &random_val, len_cur);
    }
    furi_hal_random_disable();
}

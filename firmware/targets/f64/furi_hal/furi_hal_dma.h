/**
 * @file furi_hal_dma.h
 * @brief Direct memory access (DMA) API
 *
 * @warning Only the uDMA0 module is supported as of now
 */
#pragma once

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define FURI_HAL_DMA_MAX_TRANSFER_COUNT (1024U)

typedef void (*FuriHalDmaCallback)(void* context);

typedef enum {
    FuriHalDmaChannelSrcUsart0 = 24,
    FuriHalDmaChannelDstUsart0 = 25,
    FuriHalDmaChannelSrcUart1 = 26,
    FuriHalDmaChannelDstUart1 = 27,
    FuriHalDmaChannelMax = 32,
} FuriHalDmaChannel;

typedef enum {
    FuriHalDmaTransferTypeStop,
    FuriHalDmaTransferTypeSimple,
    FuriHalDmaTransferTypeAuto,
    FuriHalDmaTransferTypePingPong,
    FuriHalDmaTransferTypeMemScatterGather,
    FuriHalDmaTransferTypeMemAltScatterGather,
    FuriHalDmaTransferTypePeriScatterGather,
} FuriHalDmaTransferType;

typedef enum {
    FuriHalDmaDataWidth8,
    FuriHalDmaDataWidth16,
    FuriHalDmaDataWidth32,
} FuriHalDmaDataWidth;

typedef enum {
    FuriHalDmaAddressIncrement8,
    FuriHalDmaAddressIncrement16,
    FuriHalDmaAddressIncrement32,
    FuriHalDmaAddressIncrementNone,
} FuriHalDmaAddressIncrement;

typedef struct {
    uint32_t src_address;
    uint32_t dst_address;
    uint32_t count;
    FuriHalDmaTransferType type;
    FuriHalDmaDataWidth src_width;
    FuriHalDmaAddressIncrement src_increment;
    FuriHalDmaDataWidth dst_width;
    FuriHalDmaAddressIncrement dst_increment;
} FuriHalDmaTransfer;

/** Early initialization */
void furi_hal_dma_init_early(void);

/** Early de-initialization */
void furi_hal_dma_deinit_early(void);

void furi_hal_dma_set_callback(
    FuriHalDmaChannel channel,
    FuriHalDmaCallback callback,
    void* context);

void furi_hal_dma_init_channel(FuriHalDmaChannel channel, const FuriHalDmaTransfer* transfer);

void furi_hal_dma_deinit_channel(FuriHalDmaChannel channel);

#ifdef __cplusplus
}
#endif

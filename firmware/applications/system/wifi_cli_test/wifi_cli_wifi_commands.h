#pragma once
#include <sl_status.h>
#include "wifi_cli_define.h"

sl_status_t wifi_init_command_handler(console_args_t* arguments);
sl_status_t wifi_deinit_command_handler(console_args_t* arguments);
sl_status_t wifi_scan_command_handler(console_args_t* arguments);

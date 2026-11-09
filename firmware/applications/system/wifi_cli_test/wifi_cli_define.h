#pragma once

#include <stdint.h>

#define MAX_ARG 10

typedef struct {
    uint32_t bitmap;
    uint32_t arg[MAX_ARG];
} console_args_t;

#define IS_CONSOLE_ARG_VALID(args, arg_number) ((args->bitmap & (1 << arg_number)) != 0)

#define GET_OPTIONAL_COMMAND_ARG(args, arg_number, default_value, type)       \
    (IS_CONSOLE_ARG_VALID(args, arg_number) ? (type)(args->arg[arg_number]) : \
                                              (type)(default_value))

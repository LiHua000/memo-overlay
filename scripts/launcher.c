#define _GNU_SOURCE
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/*
 * 速记启动器：
 * 通过 /proc/self/exe 找到自己所在的 bin 目录，
 * 再执行同级的 ../opt/memo-overlay/memo-overlay。
 * 额外补上 --no-sandbox（npm/自包含 Electron 的 chrome-sandbox 没有 setuid）。
 */
int main(int argc, char **argv) {
    char self[PATH_MAX];
    ssize_t len = readlink("/proc/self/exe", self, sizeof(self) - 1);
    if (len <= 0) {
        perror("readlink");
        return 1;
    }
    self[len] = '\0';

    char *slash = strrchr(self, '/');
    if (!slash) return 1;
    *slash = '\0';

    char target[PATH_MAX];
    int written = snprintf(target, sizeof(target), "%s/../opt/memo-overlay/memo-overlay", self);
    if (written < 0 || (size_t)written >= sizeof(target)) return 1;

    char **args = calloc((size_t)argc + 2, sizeof(char *));
    if (!args) return 1;
    args[0] = target;
    args[1] = "--no-sandbox";
    for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
    args[argc + 1] = NULL;

    execv(target, args);
    perror(target);
    return 1;
}

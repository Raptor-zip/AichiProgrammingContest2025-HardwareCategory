#ifndef LD06_H
#define LD06_H

#include <stdint.h>
#include <stddef.h>

#ifndef M_PI_F
#define M_PI_F 3.14159265358979323846f
#endif // M_PI_F

#ifdef __cplusplus
extern "C" {
#endif

#define LD06_HEADER0 0x54
#define LD06_HEADER1 0x2C
#define LD06_NUM_POINTS 12

#define LD06_DATA_SIZE 47

struct LD06;
typedef struct LD06 LD06;

struct LD06
{
    void (*receivedCallback)(LD06 *);

    size_t index;

    uint8_t data[LD06_DATA_SIZE];

    uint8_t header0;//0x54
    uint8_t header1;//0x2C
    float speed;//[rad/s]
    float start_angle;//[rad]
    float end_angle;//[rad]
    uint16_t timestamp;//max 30000
    uint8_t crc;//checksum

    float distance[LD06_NUM_POINTS];//[m]
    uint8_t confidence[LD06_NUM_POINTS];//0~255

    float step;//[rad]
    float angle[LD06_NUM_POINTS];//[rad]
};

void LD06_init(LD06 *ld06, void (*receivedCallback)(LD06 *));
void LD06_rxTask(LD06 *ld06, uint8_t data);

#ifdef __cplusplus
}
#endif

#endif // LD06_H
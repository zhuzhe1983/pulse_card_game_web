/*
 * PULSE M5Dial bridge — TinyUSB CDC transport for pcg.reader.v1.
 *
 * The M5Dial renders as a USB CDC (serial) device. The browser's Web Serial
 * path opens it and Exchanges JSON lines. We wire the protocol layer's
 * send()/write_card() to the console CDC port.
 */
#ifndef PCG_USB_CDC_H
#define PCG_USB_CDC_H

#include "pcg_proto.h"

/* Begin the USB stack (defaults) and bind proto to the CDC console port. */
int usb_cdc_start(pcg_proto_t *proto);

#endif /* PCG_USB_CDC_H */
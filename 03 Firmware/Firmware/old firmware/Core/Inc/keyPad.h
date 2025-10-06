#define TM_KEYPAD_H 200

#include "main.h"

/* Number of milliseconds between 2 reads */
#ifndef KEYPAD_READ_INTERVAL
#define KEYPAD_READ_INTERVAL        100
#endif

/* Keypad no pressed */
#define KEYPAD_NO_PRESSED			(uint8_t)0xFF

/**
 * @}
 */

/**
 * @defgroup TM_KEYPAD_Typedefs
 * @brief    Library Typedefs
 * @{
 */

/**
 * @brief  Keypad button enumeration
 */
typedef enum {
	TM_KEYPAD_Button_0 = 0x00,                     /*!< Button 0 code */
	TM_KEYPAD_Button_1 = 0x01,                     /*!< Button 1 code */
	TM_KEYPAD_Button_2 = 0x02,                     /*!< Button 2 code */
	TM_KEYPAD_Button_3 = 0x03,                     /*!< Button 3 code */
	TM_KEYPAD_Button_4 = 0x04,                     /*!< Button 4 code */
	TM_KEYPAD_Button_5 = 0x05,                     /*!< Button 5 code */
	TM_KEYPAD_Button_6 = 0x06,                     /*!< Button 6 code */
	TM_KEYPAD_Button_7 = 0x07,                     /*!< Button 7 code */
	TM_KEYPAD_Button_8 = 0x08,                     /*!< Button 8 code */
	TM_KEYPAD_Button_NOPRESSED = KEYPAD_NO_PRESSED /*!< No button pressed */
} TM_KEYPAD_Button_t;

/**
 * @defgroup TM_KEYPAD_Functions
 * @brief    Library Functions
 * @{
 */

/**
 * @brief  Initializes keypad functionality
 * @param  type: Keypad type you will use. This parameter can be a value of @ref TM_KEYPAD_Type_t enumeration
 * @retval None
 */
void TM_KEYPAD_Init(void);

/**
 * @brief  Reads keypad data
 * @param  None
 * @retval Button status. This parameter will be a value of @ref TM_KEYPAD_Button_t enumeration
 */
TM_KEYPAD_Button_t TM_KEYPAD_Read(void);

/**
 * @brief  Updates keypad
 * @note   This function must be called from interrupt routine every 1ms
 * @param  None
 * @retval None
 */
void TM_KEYPAD_Update(void);





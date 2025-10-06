/**
 * |----------------------------------------------------------------------
 * | Copyright (C) Tilen Majerle, 2014
 * |
 * | This program is free software: you can redistribute it and/or modify
 * | it under the terms of the GNU General Public License as published by
 * | the Free Software Foundation, either version 3 of the License, or
 * | any later version.
 * |
 * | This program is distributed in the hope that it will be useful,
 * | but WITHOUT ANY WARRANTY; without even the implied warranty of
 * | MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * | GNU General Public License for more details.
 * |
 * | You should have received a copy of the GNU General Public License
 * | along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * |----------------------------------------------------------------------
 */
#include "keyPad.h"

/* Pins configuration, columns are outputs */
#define KEYPAD_ROW_0_HIGH				HAL_GPIO_WritePin(Row_0_GPIO_Port, Row_0_Pin, SET)
#define KEYPAD_ROW_0_LOW				HAL_GPIO_WritePin(Row_0_GPIO_Port, Row_0_Pin, RESET)
#define KEYPAD_ROW_1_HIGH				HAL_GPIO_WritePin(Row_1_GPIO_Port, Row_1_Pin, SET)
#define KEYPAD_ROW_1_LOW				HAL_GPIO_WritePin(Row_1_GPIO_Port, Row_1_Pin, RESET)
#define KEYPAD_ROW_2_HIGH				HAL_GPIO_WritePin(Row_2_GPIO_Port, Row_2_Pin, SET)
#define KEYPAD_ROW_2_LOW				HAL_GPIO_WritePin(Row_2_GPIO_Port, Row_2_Pin, RESET)

/* Read input pins */
#define KEYPAD_COLUMN_0_CHECK			HAL_GPIO_ReadPin(Column_0_GPIO_Port, Column_0_Pin)
#define KEYPAD_COLUMN_1_CHECK			HAL_GPIO_ReadPin(Column_1_GPIO_Port, Column_1_Pin)
#define KEYPAD_COLUMN_2_CHECK			HAL_GPIO_ReadPin(Column_2_GPIO_Port, Column_2_Pin)

int KEYPAD_INT_Buttons[3][3] = {
	{0x00, 0x01, 0x02},
	{0x03, 0x04, 0x05},
	{0x06, 0x07, 0x08},
};

/* Private functions */
void TM_KEYPAD_INT_SetRow(int row);
int TM_KEYPAD_INT_CheckColumn(int column);
int TM_KEYPAD_INT_Read(void);

/* Private variables */
static TM_KEYPAD_Button_t KeypadStatus = TM_KEYPAD_Button_NOPRESSED;

void TM_KEYPAD_Init() {
	/* All rows high */
	TM_KEYPAD_INT_SetRow(99);		// out of bounds on purpose. Just to disable all the rows
}

TM_KEYPAD_Button_t TM_KEYPAD_Read(void) {
	TM_KEYPAD_Button_t temp;

	/* Get keypad status */
	temp = KeypadStatus;

	/* Reset keypad status */
	KeypadStatus = TM_KEYPAD_Button_NOPRESSED;

	return temp;
}

/* Private */
void TM_KEYPAD_INT_SetRow(int row) {
	/* Set all rows low */
	KEYPAD_ROW_0_LOW;
	KEYPAD_ROW_1_LOW;
	KEYPAD_ROW_2_LOW;

	/* Set row number high */
	if (row == 0) {
		KEYPAD_ROW_0_HIGH;
	}
	if (row == 1) {
		KEYPAD_ROW_1_HIGH;
	}
	if (row == 2) {
		KEYPAD_ROW_2_HIGH;
	}
}

int TM_KEYPAD_INT_CheckRow(int row) {
	/* Read the status of all rows in current column */

	/* Scan column 0 */
	if (KEYPAD_COLUMN_0_CHECK) {
		return KEYPAD_INT_Buttons[row][0];
	}
	/* Scan column 1 */
	if (KEYPAD_COLUMN_1_CHECK) {
		return KEYPAD_INT_Buttons[row][1];
	}
	/* Scan column 2 */
	if (KEYPAD_COLUMN_2_CHECK) {
		return KEYPAD_INT_Buttons[row][2];
	}

	/* Not pressed */
	return KEYPAD_NO_PRESSED;
}

int TM_KEYPAD_INT_Read(void) {
	uint8_t check;
	/* Set row 0 to HIGH, this is the row we are checking */
	TM_KEYPAD_INT_SetRow(0);
	/* Check columns */
	check = TM_KEYPAD_INT_CheckRow(0);		// We are checking all pins at row i
	if (check != KEYPAD_NO_PRESSED) {
		return check;
	}

	/* Set row 1 to HIGH */
	TM_KEYPAD_INT_SetRow(1);
	/* Check columns */
	check = TM_KEYPAD_INT_CheckRow(1);
	if (check != KEYPAD_NO_PRESSED) {
		return check;
	}

	/* Set row 2 to HIGH */
	TM_KEYPAD_INT_SetRow(2);
	/* Check columns */
	check = TM_KEYPAD_INT_CheckRow(2);
	if (check != KEYPAD_NO_PRESSED) {
		return check;
	}

	/* Not pressed */
	return KEYPAD_NO_PRESSED;
}

void TM_KEYPAD_Update(void) {
	static uint16_t millis = 0;

	/* Every X ms read */
	if (++millis >= KEYPAD_READ_INTERVAL && KeypadStatus == TM_KEYPAD_Button_NOPRESSED) {
		/* Reset */
		millis = 0;

		/* Read keyboard */
		KeypadStatus = (TM_KEYPAD_Button_t) TM_KEYPAD_INT_Read();
	}
}


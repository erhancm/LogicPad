/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file.
  *                   This file contains the common defines of the application.
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2025 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */

/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32f1xx_hal.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */

/* USER CODE END Includes */

/* Exported types ------------------------------------------------------------*/
/* USER CODE BEGIN ET */

/* USER CODE END ET */

/* Exported constants --------------------------------------------------------*/
/* USER CODE BEGIN EC */

/* USER CODE END EC */

/* Exported macro ------------------------------------------------------------*/
/* USER CODE BEGIN EM */

/* USER CODE END EM */

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* USER CODE BEGIN EFP */

/* USER CODE END EFP */

/* Private defines -----------------------------------------------------------*/
#define C0R0_Pin GPIO_PIN_0
#define C0R0_GPIO_Port GPIOA
#define C0R1_Pin GPIO_PIN_1
#define C0R1_GPIO_Port GPIOA
#define C0R2_Pin GPIO_PIN_2
#define C0R2_GPIO_Port GPIOA
#define C1R0_Pin GPIO_PIN_3
#define C1R0_GPIO_Port GPIOA
#define C1R1_Pin GPIO_PIN_4
#define C1R1_GPIO_Port GPIOA
#define C1R2_Pin GPIO_PIN_5
#define C1R2_GPIO_Port GPIOA
#define C2R0_Pin GPIO_PIN_6
#define C2R0_GPIO_Port GPIOA
#define C2R1_Pin GPIO_PIN_7
#define C2R1_GPIO_Port GPIOA
#define B_Ctrl_Pin GPIO_PIN_10
#define B_Ctrl_GPIO_Port GPIOB
#define Row_0_Pin GPIO_PIN_12
#define Row_0_GPIO_Port GPIOB
#define Row_1_Pin GPIO_PIN_13
#define Row_1_GPIO_Port GPIOB
#define Row_2_Pin GPIO_PIN_14
#define Row_2_GPIO_Port GPIOB
#define Selector_Pin GPIO_PIN_15
#define Selector_GPIO_Port GPIOB
#define C2R2_Pin GPIO_PIN_8
#define C2R2_GPIO_Port GPIOA
#define CtrlLed_Pin GPIO_PIN_9
#define CtrlLed_GPIO_Port GPIOA
#define Column_2_Pin GPIO_PIN_3
#define Column_2_GPIO_Port GPIOB
#define Column_1_Pin GPIO_PIN_4
#define Column_1_GPIO_Port GPIOB
#define Column_0_Pin GPIO_PIN_5
#define Column_0_GPIO_Port GPIOB
#define R_Ctrl_Pin GPIO_PIN_8
#define R_Ctrl_GPIO_Port GPIOB
#define G_Ctrl_Pin GPIO_PIN_9
#define G_Ctrl_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */

/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */

package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/playmatatu/backend/internal/config"
)

// GetConfig returns minimal config values required by frontend
func GetConfig(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"commission_flat":               cfg.CommissionFlat,
			"payout_tax_percent":            cfg.PayoutTaxPercent,
			"min_stake_amount":              cfg.MinStakeAmount,
"min_withdraw_amount":           cfg.MinWithdrawAmount,
		})
	}
}

import { TOKEN_ADDRESSES } from "@/constants/tokens";
import {
  CONTRACT_ADDRESSES,
  BALANCER_POOL_ADDRESS,
} from "@/constants/contracts";
import { MaxUint256, MIN_INPUT_VALUE } from "@/constants/numbers";
import { usePoolRouter, useTokenContract } from "@/hooks/useContract";
import useFormattedBigNumber from "@/hooks/useFormattedBigNumber";
import useInput from "@/hooks/useInput";
import useWeb3Store from "@/hooks/useWeb3Store";
import useGetPoolTokens from "@/hooks/view/useGetPoolTokens";
import useGetTokenAmountOut from "@/hooks/view/useGetTokenAmountOut";
import useTokenAllowance from "@/hooks/view/useTokenAllowance";
import useTokenBalance from "@/hooks/view/useTokenBalance";
import handleError from "@/utils/handleError";
import type { BigNumber } from "@ethersproject/bignumber";
import { formatUnits, parseUnits } from "@ethersproject/units";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import Button, { MaxButton } from "../button";
import { TransactionToast } from "../customToast";
import NumericalInput from "../numericalInput";
import TokenSelect, { Token } from "../tokenSelect";

export default function Withdraw() {
  const account = useWeb3Store((state) => state.account);
  const chainId = useWeb3Store((state) => state.chainId);

  const poolRouter = usePoolRouter();

  const { data: poolTokens } = useGetPoolTokens();

  const sovContract = useTokenContract(TOKEN_ADDRESSES.SOV[chainId]);

  const { data: sovBalance, mutate: sovBalanceMutate } = useTokenBalance(
    account,
    TOKEN_ADDRESSES.SOV[chainId]
  );
  const { data: sovAllowance, mutate: sovAllowanceMutate } = useTokenAllowance(
    TOKEN_ADDRESSES.SOV[chainId],
    account,
    CONTRACT_ADDRESSES.PoolRouter[chainId]
  );

  const [withdrawToken, withdrawTokenSet] = useState<Token>();

  const withdrawAmountInput = useInput();

  const withdrawTokenContract = useTokenContract(withdrawToken?.address);

  const { data: tokenAmountOut } = useGetTokenAmountOut(withdrawToken?.address);

  const formattedTokenAmountOut = useFormattedBigNumber(tokenAmountOut);

  const sovNeedsApproval = useMemo(() => {
    if (!!sovAllowance && withdrawAmountInput.hasValue) {
      return sovAllowance.isZero();
    }

    return;
  }, [sovAllowance, withdrawAmountInput.hasValue]);

  async function tokenWithdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const _id = toast.loading("Waiting for confirmation");

    const values = event.target as typeof event.target & {
      withdrawAmount: { value: string };
    };

    try {
      if (Number(values.withdrawAmount.value) <= MIN_INPUT_VALUE) {
        throw new Error(
          `Minium Withdraw: ${MIN_INPUT_VALUE} ${withdrawToken.symbol}`
        );
      }

      const minAmountOut = parseUnits(values.withdrawAmount.value);

      const poolBalance: BigNumber = await withdrawTokenContract.balanceOf(
        BALANCER_POOL_ADDRESS[chainId]
      );

      const maxWithdraw = poolBalance.div(3);

      if (minAmountOut.gt(maxWithdraw)) {
        const fmMaxWithdraw = parseFloat(formatUnits(maxWithdraw)).toFixed(2);

        throw new Error(
          `Maximum Withdraw: ${fmMaxWithdraw} ${withdrawToken.symbol}`
        );
      }

      const poolAmountIn: BigNumber = await poolRouter.getSovAmountInSingle(
        withdrawToken.address,
        minAmountOut,
        MaxUint256
      );

      if (poolAmountIn.gt(sovBalance)) {
        throw new Error("Not Enough SOV");
      }

      const transaction = await poolRouter.withdraw(
        withdrawToken.address,
        poolAmountIn,
        /**
         * Account for 1% slippage
         */
        minAmountOut.mul(99).div(100)
      );

      toast.loading(
        <TransactionToast
          message={`Withdraw ${values.withdrawAmount.value} ${withdrawToken.symbol}`}
          chainId={chainId}
          hash={transaction.hash}
        />,
        { id: _id }
      );

      await transaction.wait();

      toast.success(
        <TransactionToast
          message={`Withdraw ${values.withdrawAmount.value} ${withdrawToken.symbol}`}
          chainId={chainId}
          hash={transaction.hash}
        />,
        { id: _id }
      );

      sovBalanceMutate();
    } catch (error) {
      handleError(error, _id);
    }
  }

  async function approveSOV() {
    const _id = toast.loading("Waiting for confirmation");

    try {
      const transaction = await sovContract.approve(
        CONTRACT_ADDRESSES.PoolRouter[chainId],
        MaxUint256
      );

      toast.loading(`Approve SOV`, { id: _id });

      await transaction.wait();

      toast.success(`Approve SOV`, { id: _id });

      sovAllowanceMutate();
    } catch (error) {
      handleError(error, _id);
    }
  }

  const inputIsMax =
    !!tokenAmountOut &&
    withdrawAmountInput.value === formatUnits(tokenAmountOut);

  const setMax = () => {
    withdrawAmountInput.setValue(formatUnits(tokenAmountOut));
  };

  return (
    <form className="space-y-4" onSubmit={tokenWithdraw}>
      <div className="flex justify-between">
        <h2 className="font-medium leading-5">Withdraw</h2>
      </div>

      <div>
        <div className="flex space-x-4 mb-2">
          <TokenSelect
            value={withdrawToken}
            onChange={withdrawTokenSet}
            tokens={poolTokens}
          />

          <div className="flex-1">
            <label className="sr-only" htmlFor="withdrawAmount">
              Enter amount of token to receive
            </label>

            <NumericalInput
              name="withdrawAmount"
              id="withdrawAmount"
              required
              {...withdrawAmountInput.valueBind}
            />
          </div>
        </div>

        <p className="text-sm text-gray-300 h-5">
          {!!withdrawToken && tokenAmountOut && formattedTokenAmountOut ? (
            <>
              <span>{`Available: ${formattedTokenAmountOut} ${withdrawToken.symbol}`}</span>{" "}
              {!inputIsMax && <MaxButton onClick={setMax} />}
            </>
          ) : null}
        </p>
      </div>

      <div className="space-y-4">
        {sovNeedsApproval && (
          <Button onClick={approveSOV}>
            {`Approve Sovreign To Spend Your SOV`}
          </Button>
        )}

        <Button
          type="submit"
          disabled={
            !(withdrawAmountInput.hasValue && !!withdrawToken) ||
            sovNeedsApproval
          }
        >
          {withdrawAmountInput.hasValue && !!withdrawToken
            ? "Withdraw"
            : "Enter an amount"}
        </Button>
      </div>
    </form>
  );
}

import {
    isValidCron,
    getCronNextInterval

} from "../src/cron"

function getNextFiveMinutesDate(): Date {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  return now;
}

function areDatesEqualUpToMinute(date1: Date, date2: Date): boolean {

  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate() &&
    date1.getHours() === date2.getHours() &&
    date1.getMinutes() <= date2.getMinutes()
  );
}

describe("Cron facility", () => {

    it("is able to validate cron lines", () => {
    
        expect(isValidCron('0 12 * * 1')).toEqual(true)

        expect(isValidCron('* 0 0 12 1-31 * 1')).toEqual(false)

    })

    it('is able to calculate next iteration', () => {

        const d = new Date(

            getCronNextInterval("* */5 * * * *")

        )

        const plusOneMinute = getNextFiveMinutesDate()

        expect(areDatesEqualUpToMinute(d, plusOneMinute)).toEqual(true)

    })
})

import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { productCategoryRouter } from "./category";

export const productRouter = createTRPCRouter({
  category: productCategoryRouter,
  create: protectedProcedure.input(z.object({
    name: z.string().nonempty(),
    categoryId: z.string().uuid(),
  })).mutation(async ({ ctx, input }) => {
    await ctx.db.product.create({
      data: input,
    });
  }),
  update: protectedProcedure.input(z.object({
    id: z.string().uuid(),
    name: z.string(),
    categoryId: z.string().uuid(),
  }))
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      return await ctx.db.product.update({
        data: input,
        where: { id }
      }).catch((error: PrismaClientKnownRequestError) => {
        if (error.code === "P2002") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe un producto con ese nombre`
          })
        }
      })
    }),
  getAll: publicProcedure.query(({ ctx }) => {
    return ctx.db.product.findMany({
      select: {
        id: true,
        name: true,
        category: true,
      },
    });
  }),
});

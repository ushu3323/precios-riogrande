import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { env } from "~/env.mjs";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure
} from "~/server/api/trpc";
import { s3 } from "~/utils/s3";

const IMAGE_PREFIX = "pre-";

/**
 * Removes S3 image's object from "object deletion lifecycle" by removing the "pre-" prefix
 * and returns its public url
 *
 * @param imageKeyWithoutPrefix
 * @returns {string} Image public url
 */

const validateS3image = async (imageKeyWithoutPrefix: string) => {
  await s3
    .send(
      new HeadObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: IMAGE_PREFIX + imageKeyWithoutPrefix,
      }),
    )
    .catch(() => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "IMAGE_KEY_NOT_FOUND",
      });
    });

  const copyOutput = await s3.send(
    new CopyObjectCommand({
      CopySource:
        `${env.S3_BUCKET_NAME}/` + `${IMAGE_PREFIX}${imageKeyWithoutPrefix}`,
      Bucket: env.S3_BUCKET_NAME,
      Key: imageKeyWithoutPrefix,
    }),
  );

  if (!copyOutput.CopyObjectResult) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "IMAGE_VALIDATION_ERROR",
    });
  }

  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: IMAGE_PREFIX + imageKeyWithoutPrefix,
    }),
  );

  return `${env.S3_BUCKET_URL}/${imageKeyWithoutPrefix}`;
};

export const postRouter = createTRPCRouter({
  getImageSignedUrl: protectedProcedure
    .input(
      z.object({
        mimetype: z
          .string()
          .refine(
            (value) =>
              !!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(value),
            { message: "Tipo de imagen invalido" },
          ),
        length: z.number(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const key = `${randomUUID()}`;
      const expiresIn = 3600;

      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: env.S3_BUCKET_NAME,
          Key: IMAGE_PREFIX + key,
          ContentType: input.mimetype,
          ContentLength: input.length,
          Metadata: {
            author: ctx.session.user.id,
          },
        }),
        { expiresIn },
      );

      return { url, key, expiresIn };
    }),
  publish: protectedProcedure
    .input(
      z.object({
        productId: z
          .string()
          .nonempty({ message: "El producto no debe quedar vacio" })
          .pipe(z.string().uuid()),
        commerceId: z
          .string()
          .nonempty({ message: "El comercio no debe quedar vacio" })
          .pipe(z.string().uuid()),
        imageKey: z.string().nonempty({ message: "La imagen es requerida" }),
        price: z
          .number({ invalid_type_error: "Debe ingresar el precio" })
          .positive({ message: "Ingrese un precio valido" }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = DateTime.now().setZone("UTC-3").startOf("day");
      if (!now.isValid) {
        throw new Error(now.invalidReason, { cause: now.invalidExplanation })
      }

      const existentPost = await ctx.db.post.findFirst({
        where: {
          publishDate: {
            gte: now.toUTC().toISO(),
          },
          productId: input.productId,
          commerceId: input.commerceId,
          price: input.price,
        }
      });

      if (existentPost) {
        if (existentPost.authorId === ctx.session.user.id) {
          return;
        }

        return ctx.db.colaboration.create({
          data: {
            post: {
              connect: {
                id: existentPost.id,
              }
            },
            user: {
              connect: {
                id: ctx.session.user.id
              }
            }
          }
        })
      }

      // Creates the post
      const imageUrl = await validateS3image(input.imageKey);
      const post = await ctx.db.post.create({
        data: {
          product: {
            connect: { id: input.productId },
          },
          commerce: {
            connect: {
              id: input.commerceId,
            },
          },
          image: imageUrl,
          price: new Prisma.Decimal(input.price),
          author: {
            connect: {
              id: ctx.session.user.id,
            },
          },
        },
      });
      return post;
    })
  ,
  create: protectedProcedure
    .input(
      z.object({
        productId: z
          .string()
          .nonempty({ message: "El producto no debe quedar vacio" })
          .pipe(z.string().uuid()),
        commerceId: z
          .string()
          .nonempty({ message: "El comercio no debe quedar vacio" })
          .pipe(z.string().uuid()),
        imageKey: z.string().nonempty({ message: "La imagen es requerida" }),
        price: z
          .number({ invalid_type_error: "Debe ingresar el precio" })
          .positive({ message: "Ingrese un precio valido" }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const imageUrl = await validateS3image(input.imageKey);
      return ctx.db.post.create({
        data: {
          product: {
            connect: { id: input.productId },
          },
          commerce: {
            connect: {
              id: input.commerceId,
            },
          },
          image: imageUrl,
          price: new Prisma.Decimal(input.price),
          author: {
            connect: {
              id: ctx.session.user.id,
            },
          },
        },
      });
    }),
  getCount: publicProcedure.query(({ ctx }) => {
    return ctx.db.post.count()
  }),
  getAll: protectedProcedure.query(({ ctx }) => {
    return ctx.db.post.findMany({
      select: {
        id: true,
        product: true,
        commerce: true,
        price: true,
        publishDate: true,
      },
    });
  }),
  getDailyBestOffers: protectedProcedure.query(({ ctx }) => {
    const now = DateTime.now().setZone("UTC-3").startOf("day");

    return ctx.db.post.findMany({
      orderBy: [{ price: "asc" }, { publishDate: "desc" }],
      where: {
        publishDate: {
          gte: now.toUTC().toISO()!,
        },
      },
      distinct: "productId",
      select: {
        id: true,
        product: true,
        commerce: true,
        price: true,
        publishDate: true,
        image: true,
        author: true,
        _count: {
          select: {
            colaborations: true,
          }
        }
      },
    });
  }),
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return ctx.db.post.findUnique({
        where: input,
        select: {
          id: true,
          product: {
            include: { category: true }
          },
          commerce: true,
          price: true,
          publishDate: true,
          image: true,
          author: true,
          colaborations: true,
        },
      })
    }),
  getByProduct: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return ctx.db.product.findUnique({
        where: { id: input.productId },
        include: {
          category: true,
          posts: {
            select: {
              id: true,
              commerce: true,
              price: true,
              publishDate: true,
            },
          },
        },
      });
    }),
  deleteOwnPost: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
    })).mutation(async ({ ctx, input }) => {
      const { user } = ctx.session

      const post = await ctx.db.post.findUnique({
        where: {
          id: input.id
        }
      })

      if(!post) {
        throw new TRPCError({
          code: "NOT_FOUND"
        })
      }

      if(post.authorId !== user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No eres el autor de la publicación"
        })
      }

      return ctx.db.post.delete({
        where: {
          id: input.id
        }
      })
    }),
  getOwnPosts: protectedProcedure.query(({ ctx }) => {
    const { user } = ctx.session
    return ctx.db.post.findMany({
      where: {
        authorId: user.id,
      },
      select: {
        id: true,
        product: {
          include: { category: true }
        },
        commerce: true,
        price: true,
        publishDate: true,
        image: true,
        author: true,
        colaborations: true,
      },
      orderBy: {
        publishDate: "desc",
      }
    })
  }),
});
